import 'server-only';

import { Resend } from 'resend';

type AuthEmailKind = 'verify' | 'reset';

type SendAuthEmailInput = {
  to: string;
  url: string;
  kind: AuthEmailKind;
};

let resendClient: Resend | null = null;

function getResend(): Resend {
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('RESEND_API_KEY is required to send authentication email.');
  }

  resendClient ??= new Resend(apiKey);

  return resendClient;
}

function fromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;

  if (from === undefined || from.trim() === '') {
    throw new Error(
      'RESEND_FROM_EMAIL is required to send authentication email.',
    );
  }

  return from;
}

function subjectFor(kind: AuthEmailKind): string {
  if (kind === 'reset') return 'Reset your Sals3 Portal password';

  return 'Verify your Sals3 Portal email';
}

function textFor(kind: AuthEmailKind, url: string): string {
  if (kind === 'reset') {
    return `Reset your Sals3 Portal password by opening this secure link:\n\n${url}\n\nIf you did not request this, you can ignore this email.`;
  }

  return `Verify your Sals3 Portal email by opening this secure link:\n\n${url}\n\nIf you did not request this, you can ignore this email.`;
}

function htmlFor(kind: AuthEmailKind, url: string): string {
  const title =
    kind === 'reset'
      ? 'Reset your Sals3 Portal password'
      : 'Verify your Sals3 Portal email';
  const body =
    kind === 'reset'
      ? 'Use the secure link below to reset your password.'
      : 'Use the secure link below to verify your email address.';

  return `
    <main>
      <h1>${title}</h1>
      <p>${body}</p>
      <p><a href="${url}">${title}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    </main>
  `;
}

export default async function sendAuthEmail(
  input: SendAuthEmailInput,
): Promise<void> {
  const allowConsoleFallback =
    process.env.NODE_ENV !== 'production' &&
    process.env.AUTH_EMAIL_CONSOLE_FALLBACK === '1';

  if (allowConsoleFallback && process.env.RESEND_API_KEY === undefined) {
    // eslint-disable-next-line no-console -- local-only email fallback status.
    console.info(
      `[auth-email] ${input.kind} email suppressed in local fallback for ${input.to}. Link: ${input.url}`,
    );
    return;
  }

  const response = await getResend().emails.send({
    from: fromEmail(),
    to: input.to,
    subject: subjectFor(input.kind),
    text: textFor(input.kind, input.url),
    html: htmlFor(input.kind, input.url),
  });

  if (response.error !== null) {
    throw new Error(
      `Resend rejected authentication email: ${response.error.message}`,
    );
  }
}
