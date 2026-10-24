const clamp = value => Math.max(0, Math.min(1, value));

// A half-circle joins the two lanes with a forward-facing tangent at both ends.
export function createJourneyMotion(routeLength) {
  const radius = 2;
  const turnDuration = 1.05;
  let progress = null;
  let angle = 0;
  let turnStart = 0;
  let turnElapsed = null;
  let distance = 0;
  const motion = {
    active: false,
    update(target, dt, reducedMotion = false) {
      target = clamp(target);
      dt = Math.max(0, Math.min(.05, dt));
      if (progress === null) progress = target;
      const facing = Math.cos(angle) >= 0 ? 1 : -1;
      const delta = target - progress;
      if (reducedMotion) {
        if (Math.abs(delta) > .0008) angle = delta < 0 ? Math.PI : 0;
        distance += Math.abs(delta) * routeLength;
        progress = target;
        turnElapsed = null;
        motion.active = false;
      } else if (turnElapsed !== null) {
        const previousAngle = angle;
        turnElapsed = Math.min(turnDuration, turnElapsed + dt);
        angle = turnStart + Math.PI * turnElapsed / turnDuration;
        distance += (angle - previousAngle) * radius;
        if (turnElapsed === turnDuration) turnElapsed = null;
        motion.active = true;
      } else if (Math.abs(delta) > .0008 && Math.sign(delta) !== facing) {
        turnStart = angle;
        turnElapsed = 0;
        motion.active = true;
      } else {
        // Never move along the route against the direction of the cab.
        const step = Math.sign(delta) === facing ? delta * (1 - Math.exp(-12 * dt)) : 0;
        progress += step;
        distance += Math.abs(step) * routeLength;
        motion.active = Math.sign(delta) === facing && Math.abs(target - progress) > .00005;
        if (!motion.active && Math.sign(delta) === facing) progress = target;
      }
      return {
        progress,
        heading: angle,
        lateral: radius * Math.cos(angle),
        forward: turnElapsed !== null ? radius * (Math.sin(angle) - Math.sin(turnStart)) : 0,
        distance,
      };
    },
  };
  return motion;
}
