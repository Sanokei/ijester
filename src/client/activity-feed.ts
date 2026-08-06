/**
 * Activity popup: a small feed above the control bar showing what the
 * pipeline is doing — evaluation moments, the cue pill that played, or
 * "stayed quiet" when the classifier chose silence.
 */

const MAX_ENTRIES = 30;

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export class ActivityFeed {
  private readonly root: HTMLElement;
  private readonly list: HTMLUListElement;
  private pendingEval: HTMLLIElement | null = null;
  private visible = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "activity-panel";
    this.root.hidden = true;
    this.root.setAttribute("role", "log");
    this.root.setAttribute("aria-label", "Reaction activity");

    const heading = document.createElement("h3");
    heading.textContent = "activity";
    this.list = document.createElement("ul");
    this.list.className = "activity-list";

    const empty = document.createElement("li");
    empty.className = "entry empty";
    empty.textContent = "nothing yet — say something worth reacting to";
    this.list.appendChild(empty);

    this.root.append(heading, this.list);
    container.appendChild(this.root);
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.hidden = !this.visible;
    return this.visible;
  }

  hide(): void {
    this.visible = false;
    this.root.hidden = true;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** A classification round started. */
  beginEvaluation(): void {
    if (this.pendingEval) this.resolveQuiet();
    const entry = this.entry("evaluating");
    entry.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span><span>evaluating the moment…</span><time>${timestamp()}</time>`;
    this.pendingEval = entry;
  }

  /** The round produced a cue. */
  resolveCue(cueId: string, gain: number): void {
    const label = cueId.replaceAll("_", " ");
    const target = this.pendingEval ?? this.entry("cued");
    this.pendingEval = null;
    target.className = "entry cued";
    target.innerHTML = `<span class="cue-pill">${label}</span><span class="detail">gain ${gain.toFixed(2)}</span><time>${timestamp()}</time>`;
  }

  /** The round ended in deliberate silence. */
  resolveQuiet(): void {
    const entry = this.pendingEval;
    if (!entry) return;
    this.pendingEval = null;
    entry.className = "entry quiet";
    entry.innerHTML = `<span class="quiet-mark" aria-hidden="true">—</span><span>stayed quiet</span><time>${timestamp()}</time>`;
  }

  note(text: string): void {
    const entry = this.entry("noted");
    entry.innerHTML = `<span>${text}</span><time>${timestamp()}</time>`;
  }

  private entry(kind: string): HTMLLIElement {
    this.list.querySelector(".empty")?.remove();
    const li = document.createElement("li");
    li.className = `entry ${kind}`;
    this.list.prepend(li);
    while (this.list.children.length > MAX_ENTRIES) this.list.lastElementChild?.remove();
    return li;
  }
}
