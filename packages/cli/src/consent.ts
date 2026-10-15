/**
 * Explicit confirmation before an irreversible or governing action.
 *
 * Acceptance of a task's goal and criteria is a human obligation, so the only
 * accepted evidence of consent is an affirmative answer to a question that
 * showed what is being accepted. A timeout, a default, a non-interactive run or
 * an elapsed interval is never consent.
 */

export class ConsentRequiredError extends Error {
  constructor(question: string, reason: string) {
    super(`${question}\nNot accepted: ${reason}`);
    this.name = 'ConsentRequiredError';
  }
}

export interface ConsentPrompt {
  /** Shown to the human before any answer is accepted. */
  readonly question: string;
  readonly lines: readonly string[];
}

/** Only an explicit affirmative answer counts. */
export function isAffirmative(answer: string): boolean {
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

export function describePrompt(prompt: ConsentPrompt): string {
  return [...prompt.lines, '', `${prompt.question} [y/N] `].join('\n');
}

/**
 * Runs a prompt in an interactive session.
 *
 * `ask` receives the rendered prompt and returns the raw answer. When the
 * session is not interactive, `ask` is never called and consent fails instead.
 */
export async function requestConsent(
  prompt: ConsentPrompt,
  ask: (rendered: string) => Promise<string>,
): Promise<void> {
  const answer = await ask(describePrompt(prompt));
  if (!isAffirmative(answer)) {
    throw new ConsentRequiredError(
      prompt.question,
      answer.trim().length === 0 ? 'no answer was given' : `the answer was "${answer.trim()}"`,
    );
  }
}

/**
 * The non-interactive counterpart.
 *
 * `--yes` is accepted only where the command is documented as safe to run
 * unattended. Admission is not: it changes accepted obligations, so this
 * refuses unless a caller explicitly declares that the user already confirmed
 * out of band.
 */
export function requirePreconfirmedConsent(prompt: ConsentPrompt, confirmedOutOfBand: boolean): void {
  if (!confirmedOutOfBand) {
    throw new ConsentRequiredError(
      prompt.question,
      'this session cannot ask, and no out-of-band confirmation was recorded',
    );
  }
}
