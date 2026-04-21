import argparse
import json
import mimetypes
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Batch upload/publish for multiple TikTok shop accounts with "
            "per-account product mapping and 30-minute schedule spacing"
        )
    )

    parser.add_argument(
        "--root-dir",
        default=r"C:\Users\ROG\Desktop\weekend multi upload",
        help="Root folder containing account folders 1..8 and publish1..8 txt files",
    )
    parser.add_argument(
        "--start-time",
        default="2026-03-28T00:00:00Z",
        help="First publish time in UTC, e.g. 2026-03-28T00:00:00Z",
    )
    parser.add_argument(
        "--interval-minutes",
        type=int,
        default=30,
        help="Per-account publish interval in minutes",
    )

    parser.add_argument(
        "--create-record-url",
        default="https://www.sparkboost.ai/api/v1/tiktok/local-upload/create-record",
    )
    parser.add_argument(
        "--upload-url",
        default="https://www.sparkboost.ai/api/v1/tiktok/local-upload/upload-file",
    )
    parser.add_argument(
        "--list-url",
        default="https://www.sparkboost.ai/api/v1/tiktok/local-upload/list",
    )
    parser.add_argument(
        "--publish-url",
        default="https://www.sparkboost.ai/api/v1/tiktok/video/publish",
    )

    parser.add_argument(
        "--upload-mode",
        choices=["auto", "multipart", "urlencoded_name"],
        default="auto",
    )
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--sleep-seconds", type=float, default=0.3)
    parser.add_argument("--upload-wait-seconds", type=int, default=180)
    parser.add_argument("--upload-poll-interval", type=float, default=2.0)

    parser.add_argument(
        "--cookie",
        default=os.getenv("SPARKBOOST_COOKIE", ""),
        help="Sparkboost login cookie (or set SPARKBOOST_COOKIE)",
    )
    parser.add_argument(
        "--authorization",
        default=os.getenv("SPARKBOOST_AUTHORIZATION", ""),
        help="Authorization header value, e.g. Bearer xxx",
    )
    parser.add_argument(
        "--extra-headers-json",
        default=os.getenv("SPARKBOOST_EXTRA_HEADERS_JSON", ""),
        help='Additional headers JSON, e.g. {"x-foo":"bar"}',
    )

    parser.add_argument(
        "--result-file",
        default=f"sparkboost_multi_result_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl",
    )

    return parser.parse_args()


def parse_utc_start_time(start_time_text: str) -> datetime:
    text = start_time_text.strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def format_utc_millis(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def safe_json(resp: requests.Response) -> Dict:
    try:
        return resp.json()
    except Exception:
        return {"raw": resp.text}


def get_by_candidate_keys(obj: object, keys: Tuple[str, ...]) -> Optional[object]:
    if not isinstance(obj, dict):
        return None
    for key in keys:
        if key in obj and obj[key] not in (None, ""):
            return obj[key]
    return None


def build_headers(args: argparse.Namespace) -> Dict[str, str]:
    headers: Dict[str, str] = {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
    }

    if args.cookie:
        headers["Cookie"] = args.cookie
    if args.authorization:
        headers["Authorization"] = args.authorization

    if args.extra_headers_json:
        extra = json.loads(args.extra_headers_json)
        if not isinstance(extra, dict):
            raise ValueError("--extra-headers-json must be a JSON object")
        headers.update({str(k): str(v) for k, v in extra.items()})

    return headers


def numeric_sort_key(path: Path) -> Tuple[int, str]:
    stem = path.stem
    try:
        return int(stem), path.name
    except Exception:
        return 10**18, path.name


def collect_account_files(account_dir: Path) -> List[Path]:
    files = [
        p
        for p in account_dir.iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
    ]
    files.sort(key=numeric_sort_key)
    return files


def load_publish_template(publish_file: Path) -> Dict:
    text = publish_file.read_text(encoding="utf-8")
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError(f"publish file must be JSON object: {publish_file}")
    required = [
        "authId",
        "productId",
        "productAnchorTitle",
        "productImageUrl",
    ]
    missing = [k for k in required if k not in data]
    if missing:
        raise ValueError(f"Missing keys in {publish_file.name}: {missing}")
    return data


def create_record(
    session: requests.Session,
    args: argparse.Namespace,
    headers: Dict[str, str],
    file_path: Path,
) -> Dict:
    req_headers = dict(headers)
    req_headers["Content-Type"] = "application/json"

    payload = {"fileName": file_path.name, "fileSize": file_path.stat().st_size}
    resp = session.post(
        args.create_record_url,
        headers=req_headers,
        data=json.dumps(payload, ensure_ascii=False),
        timeout=args.timeout,
    )

    body = safe_json(resp)
    if not resp.ok:
        raise RuntimeError(f"Create-record HTTP {resp.status_code}: {body}")
    if isinstance(body, dict) and body.get("success") is False:
        raise RuntimeError(f"Create-record API failed: {body}")
    return body


def extract_record_id(create_resp: Dict) -> int:
    data = create_resp.get("data")

    if isinstance(data, (int, str)):
        try:
            return int(data)
        except Exception:
            pass

    rid = get_by_candidate_keys(
        data,
        ("id", "recordId", "localUploadRecordId", "uploadRecordId"),
    )
    if rid is None:
        rid = get_by_candidate_keys(
            create_resp,
            ("id", "recordId", "localUploadRecordId", "uploadRecordId"),
        )
    if rid is None:
        raise ValueError(f"Cannot extract record id from create-record response: {create_resp}")
    return int(rid)


def _upload_by_mode(
    session: requests.Session,
    args: argparse.Namespace,
    headers: Dict[str, str],
    file_path: Path,
    record_id: int,
    mode: str,
) -> Dict:
    if mode == "multipart":
        mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        with file_path.open("rb") as fh:
            resp = session.post(
                args.upload_url,
                headers=headers,
                data={"recordId": str(record_id)},
                files={"file": (file_path.name, fh, mime)},
                timeout=args.timeout,
            )
    else:
        req_headers = dict(headers)
        req_headers["Content-Type"] = "application/x-www-form-urlencoded"
        resp = session.post(
            args.upload_url,
            headers=req_headers,
            data={"recordId": str(record_id), "file": file_path.name},
            timeout=args.timeout,
        )

    body = safe_json(resp)
    if not resp.ok:
        raise RuntimeError(f"Upload HTTP {resp.status_code}: {body}")
    if isinstance(body, dict) and body.get("success") is False:
        raise RuntimeError(f"Upload API failed: {body}")
    return body


def upload_one(
    session: requests.Session,
    args: argparse.Namespace,
    headers: Dict[str, str],
    file_path: Path,
    record_id: int,
) -> Dict:
    if args.upload_mode in ("multipart", "urlencoded_name"):
        return _upload_by_mode(session, args, headers, file_path, record_id, args.upload_mode)

    last_err: Optional[Exception] = None
    for mode in ("multipart", "urlencoded_name"):
        try:
            return _upload_by_mode(session, args, headers, file_path, record_id, mode)
        except Exception as exc:
            last_err = exc
            print(f"  upload mode={mode} failed, trying fallback")

    if last_err:
        raise last_err
    raise RuntimeError("Upload failed with unknown error")


def try_extract_video_url(upload_resp: Dict) -> Optional[str]:
    data = upload_resp.get("data")
    if isinstance(data, str) and data.startswith("http"):
        return data

    val = get_by_candidate_keys(data, ("videoFileUrl", "fileUrl", "url", "videoUrl"))
    return str(val) if val else None


def fetch_record_by_id(
    session: requests.Session,
    args: argparse.Namespace,
    headers: Dict[str, str],
    record_id: int,
) -> Optional[Dict]:
    resp = session.get(
        args.list_url,
        headers=headers,
        params={"page": 1, "pageSize": 100},
        timeout=args.timeout,
    )

    body = safe_json(resp)
    if not resp.ok:
        raise RuntimeError(f"List HTTP {resp.status_code}: {body}")
    if isinstance(body, dict) and body.get("success") is False:
        raise RuntimeError(f"List API failed: {body}")

    data = body.get("data") if isinstance(body, dict) else None
    rows = data.get("list") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return None

    for row in rows:
        if isinstance(row, dict) and str(row.get("id")) == str(record_id):
            return row
    return None


def wait_for_video_url(
    session: requests.Session,
    args: argparse.Namespace,
    headers: Dict[str, str],
    record_id: int,
) -> str:
    deadline = time.time() + max(1, args.upload_wait_seconds)
    while time.time() < deadline:
        row = fetch_record_by_id(session, args, headers, record_id)
        if isinstance(row, dict):
            status = str(row.get("status") or "")
            video_url = row.get("videoUrl")
            if video_url:
                return str(video_url)
            if status == "UPLOAD_FAILED":
                err = row.get("errorMessage") or "UPLOAD_FAILED"
                raise RuntimeError(f"Async upload failed: {err}")
        time.sleep(max(0.2, args.upload_poll_interval))

    raise TimeoutError(
        f"Timed out waiting video URL for recordId={record_id} after {args.upload_wait_seconds}s"
    )


def publish_one(
    session: requests.Session,
    args: argparse.Namespace,
    headers: Dict[str, str],
    template: Dict,
    video_url: str,
    local_record_id: int,
    scheduled_time: str,
) -> Dict:
    payload = {
        "authId": str(template["authId"]),
        "videoSourceType": "LOCAL_UPLOAD",
        "videoFileUrl": video_url,
        "videoTitle": template.get("videoTitle", ""),
        "productId": str(template["productId"]),
        "productAnchorTitle": template.get("productAnchorTitle", ""),
        "productImageUrl": template.get("productImageUrl", ""),
        "needPrecheck": bool(template.get("needPrecheck", False)),
        "localUploadRecordId": int(local_record_id),
        "scheduledPublishTime": scheduled_time,
    }

    req_headers = dict(headers)
    req_headers["Content-Type"] = "application/json"

    resp = session.post(
        args.publish_url,
        headers=req_headers,
        data=json.dumps(payload, ensure_ascii=False),
        timeout=args.timeout,
    )

    body = safe_json(resp)
    if not resp.ok:
        raise RuntimeError(f"Publish HTTP {resp.status_code}: {body}")
    if isinstance(body, dict) and body.get("success") is False:
        raise RuntimeError(f"Publish API failed: {body}")
    return body


def build_jobs(args: argparse.Namespace) -> List[Dict]:
    root = Path(args.root_dir)
    if not root.is_dir():
        raise FileNotFoundError(f"Root dir not found: {root}")

    start_dt = parse_utc_start_time(args.start_time)
    interval = timedelta(minutes=max(1, args.interval_minutes))

    jobs: List[Dict] = []
    for account_index in range(1, 9):
        folder = root / str(account_index)
        publish_file = root / f"publish{account_index}.txt"

        if not folder.is_dir():
            raise FileNotFoundError(f"Missing account folder: {folder}")
        if not publish_file.is_file():
            raise FileNotFoundError(f"Missing publish file: {publish_file}")

        template = load_publish_template(publish_file)
        videos = collect_account_files(folder)
        if not videos:
            continue

        for i, file_path in enumerate(videos):
            scheduled = format_utc_millis(start_dt + i * interval)
            jobs.append(
                {
                    "accountIndex": account_index,
                    "file": file_path,
                    "template": template,
                    "scheduledPublishTime": scheduled,
                }
            )

    return jobs


def main() -> None:
    args = parse_args()
    headers = build_headers(args)
    if "Cookie" not in headers and "Authorization" not in headers:
        print("WARN: no Cookie/Authorization provided. API may return USER_NOT_LOGIN.")

    jobs = build_jobs(args)
    if not jobs:
        print("No videos found in account folders 1..8")
        return

    result_path = Path(args.result_file)
    if not result_path.is_absolute():
        result_path = Path.cwd() / result_path

    by_account: Dict[int, int] = {}
    for job in jobs:
        idx = int(job["accountIndex"])
        by_account[idx] = by_account.get(idx, 0) + 1

    print(f"Total jobs: {len(jobs)}")
    print("Per-account counts: " + json.dumps(by_account, ensure_ascii=False, sort_keys=True))
    print(f"Result log: {result_path}")

    session = requests.Session()
    ok_count = 0
    fail_count = 0

    with result_path.open("a", encoding="utf-8") as out:
        for n, job in enumerate(jobs, start=1):
            file_path: Path = job["file"]
            template: Dict = job["template"]
            account_index = int(job["accountIndex"])
            scheduled_time = str(job["scheduledPublishTime"])

            item = {
                "index": n,
                "accountIndex": account_index,
                "file": str(file_path),
                "authId": str(template.get("authId", "")),
                "productId": str(template.get("productId", "")),
                "scheduledPublishTime": scheduled_time,
                "status": "unknown",
                "createRecordResponse": None,
                "uploadResponse": None,
                "publishResponse": None,
                "videoFileUrl": None,
                "localUploadRecordId": None,
                "error": None,
            }

            print(
                f"[{n}/{len(jobs)}] acc={account_index} "
                f"file={file_path.name} schedule={scheduled_time}"
            )

            try:
                create_resp = create_record(session, args, headers, file_path)
                record_id = extract_record_id(create_resp)

                upload_resp = upload_one(session, args, headers, file_path, record_id)
                video_url = try_extract_video_url(upload_resp)
                if not video_url:
                    print("  waiting async upload to finish...")
                    video_url = wait_for_video_url(session, args, headers, record_id)

                publish_resp = publish_one(
                    session,
                    args,
                    headers,
                    template,
                    video_url,
                    record_id,
                    scheduled_time,
                )

                item["status"] = "ok"
                item["createRecordResponse"] = create_resp
                item["uploadResponse"] = upload_resp
                item["publishResponse"] = publish_resp
                item["videoFileUrl"] = video_url
                item["localUploadRecordId"] = record_id

                ok_count += 1
                print(f"  OK -> {video_url}")

            except Exception as exc:
                item["status"] = "failed"
                item["error"] = str(exc)
                fail_count += 1
                print(f"  FAILED -> {exc}")

            out.write(json.dumps(item, ensure_ascii=False) + "\n")
            out.flush()

            if args.sleep_seconds > 0:
                time.sleep(args.sleep_seconds)

    print("Done")
    print(f"Success: {ok_count}, Failed: {fail_count}")


if __name__ == "__main__":
    main()
