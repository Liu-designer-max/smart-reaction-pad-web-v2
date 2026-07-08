export const UI_STATES = {
  DISCONNECTED: "DISCONNECTED",
  CONNECTED: "CONNECTED",
  CALIBRATING: "CALIBRATING",
  READY: "READY",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  COMPLETE: "COMPLETE",
  STOPPED: "STOPPED",
  ERROR: "ERROR",
};

export function isRunningState(state) {
  return state === UI_STATES.CALIBRATING || state === UI_STATES.STARTING || state === UI_STATES.RUNNING;
}

export function controlsForState(state) {
  return {
    connectDisabled: isRunningState(state),
    calibrateDisabled: state === UI_STATES.DISCONNECTED || isRunningState(state),
    startDisabled: state !== UI_STATES.READY && state !== UI_STATES.COMPLETE && state !== UI_STATES.STOPPED,
    stopDisabled: !isRunningState(state),
    protocolDisabled: isRunningState(state),
    demoDisabled: isRunningState(state),
    participantDisabled: isRunningState(state),
  };
}

export function canStartHardware(state, connected, calibrated) {
  return connected && calibrated && (state === UI_STATES.READY || state === UI_STATES.COMPLETE || state === UI_STATES.STOPPED);
}
