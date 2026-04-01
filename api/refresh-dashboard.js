module.exports = async (req, res) => {
  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  const secret = process.env.DASHBOARD_REFRESH_SECRET;

  if (!deployHookUrl) {
    res.status(500).json({ ok: false, error: 'VERCEL_DEPLOY_HOOK_URL missing' });
    return;
  }

  if (secret && req.headers['x-refresh-secret'] !== secret) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const response = await fetch(deployHookUrl, { method: 'POST' });
  const text = await response.text();

  res.status(response.ok ? 200 : 502).json({
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 500),
  });
};
