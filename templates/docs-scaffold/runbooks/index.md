# Runbooks index

Environment, deploy, run, and verification steps live here. **Stack/env-specific hooks** (per SOP
§2.3) belong here, not in the methodology docs — e.g. line-ending (CRLF) upload checks, transfer
rate limits (`${RSYNC_BWLIMIT}`), host-specific deploy constraints, service restart procedures.

The `deploy-runner` agent follows a runbook step-by-step and halts on any anomaly; declare each
deploy's target, expected results, and any stack hooks here so the agent has them.

| runbook | purpose |
|---|---|
| <path> | <one line> |
