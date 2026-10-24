/** Canonical job capability contract; synchronized to the web client. */
export interface JobCapabilities {
  edit: boolean;
  changeStatus: boolean;
  findMatches: boolean;
  managePublication: boolean;
  submitCandidate: boolean;
}
