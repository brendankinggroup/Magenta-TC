// ─── Slack Incoming Webhook ───────────────────────────────────────────────────

export async function notifySlack(data, type = 'new-file') {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  let text, color;

  if (type === 'new-file') {
    color = data.urgent ? '#FFB300' : '#4D0D30';
    text = [
      data.urgent ? '🚨 *URGENT FILE*' : '📁 *New File Submitted*',
      `*Property:* ${data.propertyAddress || '—'}`,
      `*Type:* ${data.transactionType || '—'}`,
      `*Agent:* ${data.agentName || '—'}`,
      `*Client(s):* ${data.clientNames || '—'}`,
      `*COE:* ${data.coeDate || '—'}`,
      `*Sale Price:* ${data.salePrice || '—'}`,
      data.driveFolderUrl ? `<${data.driveFolderUrl}|📁 Open Drive Folder>` : '',
    ].filter(Boolean).join('\n');
  } else {
    color = '#B32D7F';
    text = [
      '👤 *New Agent Onboarding*',
      `*Agent:* ${data.agentName || '—'}`,
      `*Brokerage:* ${data.brokerage || '—'}`,
      `*Platform:* ${data.docPlatform || '—'}`,
      `*Email:* ${data.agentEmail || '—'}`,
    ].join('\n');
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachments: [{
        color,
        text,
        footer: 'Magenta TC',
        ts: Math.floor(Date.now() / 1000),
      }],
    }),
  });
}

// ─── Twilio SMS ───────────────────────────────────────────────────────────────

export async function notifySMS(data, type = 'new-file') {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const to = process.env.TWILIO_TO;

  if (!accountSid || !authToken || !from || !to) return;

  let body;
  if (type === 'new-file') {
    body = data.urgent
      ? `🚨 URGENT FILE — ${data.propertyAddress} | COE: ${data.coeDate} | Agent: ${data.agentName}`
      : `New File: ${data.propertyAddress} | ${data.transactionType} | COE: ${data.coeDate} | Agent: ${data.agentName}`;
  } else {
    body = `New Agent Onboarding: ${data.agentName} @ ${data.brokerage}`;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const encoded = new URLSearchParams({ From: from, To: to, Body: body });

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
    body: encoded,
  });
}
