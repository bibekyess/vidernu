/**
 * Toolbar badge state machine (FR-1.3). Pure mapping from `ModelStatus` to
 * `chrome.action` calls — the badge text carries the advancing percentage,
 * the title carries the full "DL: 45%"-style wording.
 */
import {
  BADGE_COLOR,
  formatBadgeText,
  formatBadgeTitle,
  type ModelStatus,
} from "../shared/constants";

export function setBadge(status: ModelStatus, progress?: number): void {
  void chrome.action.setBadgeText({ text: formatBadgeText(status, progress) });
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR[status] });
  void chrome.action.setTitle({ title: formatBadgeTitle(status, progress) });
}
