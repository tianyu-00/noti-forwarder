// A dual-SIM phone lists its SIMs: { id, slot, name, allowed }. `slot` counts from 1, `name` is the
// carrier (never a number), `allowed` is whether the phone lets replies go out on that SIM.

export function simLabel(sim) {
  return sim.name ? `SIM ${sim.slot} · ${sim.name}` : `SIM ${sim.slot}`;
}

// The SIM a reply starts on: the one that received the text, if the phone allows it; otherwise the only
// allowed SIM; otherwise none, and the user has to choose.
export function defaultSim(sims, receivedSim) {
  const allowed = sims.filter((s) => s.allowed);
  if (receivedSim != null && allowed.some((s) => s.id === receivedSim))
    return receivedSim;
  return allowed.length === 1 ? allowed[0].id : null;
}
