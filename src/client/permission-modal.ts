/**
 * Branded pre-permission explanation. The browser's native microphone
 * prompt still follows — this modal only sets expectations before it.
 */
export type PermissionChoice = "allow" | "later";

export function showPermissionModal(): Promise<PermissionChoice> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `
      <h2>Let iJester listen?</h2>
      <p>
        iJester listens to the conversation in the room and occasionally plays a
        reaction sound — a laugh, an “ooo,” a gasp — when the moment truly calls
        for it. Silence is its default.
      </p>
      <ul>
        <li>Short snippets of speech are transcribed to pick a reaction.</li>
        <li>Raw audio is not stored; transcripts live only for this visit.</li>
        <li>Nothing said out loud can control the app or its sounds.</li>
        <li>Your browser will ask for microphone permission next.</li>
      </ul>
      <p class="privacy-note">
        <button type="button" class="privacy-link" data-action="privacy">How privacy works</button>
      </p>
      <div class="modal-actions">
        <button type="button" class="primary" data-action="allow" autofocus>Allow microphone</button>
        <button type="button" data-action="later">Not now</button>
      </div>
    `;
    document.body.appendChild(dialog);

    const finish = (choice: PermissionChoice) => {
      dialog.close();
      dialog.remove();
      resolve(choice);
    };

    dialog.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).dataset["action"];
      if (action === "allow") finish("allow");
      if (action === "later") finish("later");
      if (action === "privacy") showPrivacyModal();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("later");
    });

    dialog.showModal();
  });
}

export function showPrivacyModal(): void {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `
    <h2>How privacy works</h2>
    <p>
      While listening, your microphone audio is split into short speech
      snippets. Each snippet is sent over an encrypted connection to this
      site's server, transcribed, and immediately discarded — raw audio is
      never written to storage, logs, or analytics.
    </p>
    <p>
      A rolling transcript of roughly the last forty seconds is kept in memory
      to judge the moment, then deleted. Ending the session, or half an hour of
      inactivity, deletes everything. Nothing is used for training.
    </p>
    <p>
      A visible indicator stays on screen whenever the microphone is live. If
      other people are in the room, please make sure they're okay with the
      microphone being on — in some places that's legally required.
    </p>
    <div class="modal-actions">
      <button type="button" class="primary" data-action="close" autofocus>Got it</button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).dataset["action"] === "close") {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}
