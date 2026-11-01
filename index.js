/**
 * Host half of the approval-timeout bundle.
 *
 * The browser half owns the behavior: it watches the Client's pending
 * interactions and, at the deadline, answers an approval with `rejected` or a
 * question with the skip batch — exactly the payloads the answer panel sends.
 * This Host half exists only so the bundle owns a Loader row, which is what
 * makes the Client module system load `./client.js`.
 */
export function apply() {}
