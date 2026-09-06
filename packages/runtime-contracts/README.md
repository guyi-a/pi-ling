# @pi-ling/runtime-contracts

Provider-neutral runtime control contract shared by Native and DSH.

The interface covers session creation/resume, prompt, cancel, permission,
close, event subscription, capabilities, and disposal. Renderer code does not
depend on this package; Electron Main projects runtime events into the existing
timeline protocol.
