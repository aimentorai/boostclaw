from copaw.agents.model_factory import _should_promote_tool_result_images


def test_should_promote_tool_result_images_for_openai() -> None:
    assert (
        _should_promote_tool_result_images(
            provider_id="openai",
            provider_base_url="https://api.openai.com/v1",
        )
        is True
    )


def test_should_not_promote_tool_result_images_for_deepseek_provider_id() -> None:
    assert (
        _should_promote_tool_result_images(
            provider_id="deepseek",
            provider_base_url="https://api.openai.com/v1",
        )
        is False
    )


def test_should_not_promote_tool_result_images_for_deepseek_base_url() -> None:
    assert (
        _should_promote_tool_result_images(
            provider_id="custom-openai",
            provider_base_url="https://api.deepseek.com",
        )
        is False
    )
