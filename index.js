/**
 * Host half of the approval-timeout bundle.
 *
 * The browser half owns the behavior: it watches the Client's pending
 * interactions and answers an unanswered approval with `rejected` at the
 * deadline. This Host half exists only so the bundle owns a Loader row, which
 * is what makes the Client module system load `./client.js`.
 */
export function apply() {}
