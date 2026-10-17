// Talk to the Fieldstate conductor as this workflow run. Identity is a
// GitHub Actions OIDC token (audience "fieldstate-video"); the conductor
// accepts it only from render.yml on main in rpeck27/fieldstate-video,
// started by workflow_dispatch. There is no shared secret.
import { readFile, stat } from "node:fs/promises";

export const AUDIENCE = "fieldstate-video";

export async function oidcToken(fetchImpl = fetch, env = process.env) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) {
    throw new Error("no OIDC token: the workflow needs `permissions: id-token: write`");
  }
  const resp = await fetchImpl(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`oidc http ${resp.status}`);
  const body = await resp.json();
  if (!body.value) throw new Error("oidc: empty token");
  return body.value;
}

function q(renderId) {
  return renderId ? `?render_id=${encodeURIComponent(renderId)}` : "";
}

async function call(base, path, init = {}, fetchImpl = fetch) {
  // A fresh token per call: they expire within minutes and a render is longer.
  const token = await oidcToken(fetchImpl);
  const resp = await fetchImpl(`${base.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const text = await resp.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!resp.ok) throw new Error(`conductor ${path.split("?")[0]} http ${resp.status} ${JSON.stringify(body)}`);
  return body;
}

export function fetchScript(base, renderId, fetchImpl) {
  return call(base, `/video/render/script${q(renderId)}`, {}, fetchImpl);
}

export async function uploadFile(base, renderId, name, path, contentType, fetchImpl) {
  const size = (await stat(path)).size;
  const data = await readFile(path);
  return call(
    base,
    `/video/render/upload/${name}${q(renderId)}`,
    { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(size) }, body: data },
    fetchImpl,
  );
}

export function reportDone(base, renderId, facts, fetchImpl) {
  return call(
    base,
    `/video/render/done${q(renderId)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(facts) },
    fetchImpl,
  );
}

export function reportFailed(base, renderId, step, fetchImpl) {
  return call(
    base,
    `/video/render/failed${q(renderId)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step }) },
    fetchImpl,
  );
}
