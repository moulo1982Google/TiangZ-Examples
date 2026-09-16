export function plan(profile) {
  const checks = ["routing-tests", "protocol-check", "module-typecheck"];
  if (profile === "check") return checks;
  const local = [...checks, "build", "local-acceptance"];
  if (profile === "local") return local;
  if (profile === "container") return [...local, "image", "deploy", "container-acceptance", "cleanup"];
  throw new Error("profile must be check, local or container (production deployment is not enabled)");
}

export async function execute(steps, run, record) {
  for (const name of steps) {
    const step = { name, startedAt: new Date().toISOString(), status: "running" };
    record.steps.push(step);
    try { await run(name); step.status = "passed"; }
    catch (error) { step.status = "failed"; step.error = error.message; throw error; }
    finally { step.finishedAt = new Date().toISOString(); }
  }
}
