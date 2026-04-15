import type { TaskProgressPresentation } from './text-formatting';

interface TaskProgressTextProps {
  progress: TaskProgressPresentation;
  title: string;
}

export function TaskProgressText({ progress, title }: TaskProgressTextProps) {
  return (
    <div
      data-testid="chat-task-progress-text"
      className="not-prose rounded-md bg-[#f7f7f7] px-3 py-2.5 text-foreground dark:bg-white/[0.06]"
    >
      {progress.intro && (
        <p className="mb-2 text-[13px] leading-5 text-foreground/85">{progress.intro}</p>
      )}
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <ol className="mt-2 space-y-1.5">
        {progress.steps.map((step, index) => (
          <li key={`${index}-${step}`} className="flex items-start gap-2">
            <span className="mt-0.5 flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-primary text-[10px] font-medium leading-none text-white">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 text-[13px] leading-5 text-foreground/80">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
