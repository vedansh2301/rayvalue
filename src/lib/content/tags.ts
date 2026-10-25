/** Display tag for an article card: the state it covers (or "Florida and California"). */
export function stateTag(state: 'FL' | 'CA' | 'both' | undefined): string {
  return state === 'FL' ? 'Florida' : state === 'CA' ? 'California' : 'Florida and California';
}
