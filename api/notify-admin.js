export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { username, email } = req.body || {};
  if (!username || !email) return res.status(400).json({ error: "Missing fields" });

  if (!process.env.RESEND_API_KEY) {
    // Email not configured — silently succeed so signup still works
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Kin Kin App <onboarding@resend.dev>",
        to: ["info@kinkintrukindo.com"],
        subject: `New signup request: ${username}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1B3F60; margin: 0 0 16px;">New User Registration</h2>
            <p><strong>${username}</strong> (${email}) has requested access to the Kin Kin app.</p>
            <p>Please log in as admin to approve or reject the request.</p>
            <a href="https://kinkintrukindo.com" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #1B3F60; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">Open App</a>
          </div>
        `,
      }),
    });

    return res.status(response.ok ? 200 : 500).json({ ok: response.ok });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
