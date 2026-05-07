import { Notice } from 'obsidian';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class ProgressNotice {
  private notice: Notice;
  private intervalId: number;
  private frame = 0;
  private message: string;

  constructor(initialMessage: string) {
    this.message = initialMessage;
    this.notice = new Notice(this.render(), 0);
    this.intervalId = window.setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.notice.setMessage(this.render());
    }, 80);
  }

  update(message: string): void {
    this.message = message;
    this.notice.setMessage(this.render());
  }

  finish(message: string): void {
    this.dispose();
    new Notice(message);
  }

  fail(message: string): void {
    this.dispose();
    new Notice(message);
  }

  private dispose(): void {
    window.clearInterval(this.intervalId);
    this.notice.hide();
  }

  private render(): string {
    return `${FRAMES[this.frame]} ${this.message}`;
  }
}

// Yields to the renderer so DOM updates paint before the next await
export function yieldToUI(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
