"use client";

export type ControlsCopy = {
  hide: string;
  pause: string;
  resume: string;
  voiceOn: string;
  voiceOff: string;
  restart: string;
  noRoam: string;
  roam: string;
  settings: string;
  settingsLabel: string;
  quickLabel: string;
};

export type ControlsState = { paused: boolean; voice: boolean; voiceAvailable: boolean; noRoam: boolean };

/**
 * Always-in-the-DOM quick controls (pause and hide). They are visually tucked away until Tween or one of them has focus
 * or the pointer is over Tween, so a keyboard user reaches them with the first Tab presses after the Tween button.
 */
export function QuickControls({ copy, state, onPause, onHide }: { copy: ControlsCopy; state: ControlsState; onPause: () => void; onHide: () => void }) {
  return (
    <div role="group" aria-label={copy.quickLabel} data-tween="quick" className="tw-quick">
      <button type="button" data-tween="pause" className="tw-icon-btn" onClick={onPause}>
        <span className="sr-only">{state.paused ? copy.resume : copy.pause}</span>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          {state.paused ? <path d="M6 4 L16 10 L6 16 Z" fill="currentColor" /> : <path d="M5 4 H8 V16 H5 Z M12 4 H15 V16 H12 Z" fill="currentColor" />}
        </svg>
      </button>
      <button type="button" data-tween="hide" className="tw-icon-btn" onClick={onHide}>
        <span className="sr-only">{copy.hide}</span>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** The settings list inside the panel: every control is a labelled button. */
export function SettingsMenu({
  copy,
  state,
  onPause,
  onVoice,
  onRoam,
  onRestart,
  onHide,
}: {
  copy: ControlsCopy;
  state: ControlsState;
  onPause: () => void;
  onVoice: () => void;
  onRoam: () => void;
  onRestart: () => void;
  onHide: () => void;
}) {
  return (
    <ul aria-label={copy.settingsLabel} data-tween="settings" className="tw-menu">
      <li>
        <button type="button" data-tween="pause-setting" onClick={onPause}>
          {state.paused ? copy.resume : copy.pause}
        </button>
      </li>
      {state.voiceAvailable && (
        <li>
          <button type="button" data-tween="voice" onClick={onVoice}>
            {state.voice ? copy.voiceOff : copy.voiceOn}
          </button>
        </li>
      )}
      <li>
        <button type="button" data-tween="roam" onClick={onRoam}>
          {state.noRoam ? copy.roam : copy.noRoam}
        </button>
      </li>
      <li>
        <button type="button" data-tween="restart" onClick={onRestart}>
          {copy.restart}
        </button>
      </li>
      <li>
        <button type="button" data-tween="hide-setting" onClick={onHide}>
          {copy.hide}
        </button>
      </li>
    </ul>
  );
}
