import { describe, expect, it } from 'vitest';
import { isRightPaneGesture } from './rightPaneGesture';

const gesture = (
  overrides: Partial<Parameters<typeof isRightPaneGesture>[0]> = {},
) => ({
  button: 0,
  shiftKey: true,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...overrides,
});

describe('isRightPaneGesture', () => {
  it('accepts an exact primary-button Shift-click', () => {
    expect(isRightPaneGesture(gesture())).toBe(true);
  });

  it('rejects other buttons and additional modifiers', () => {
    expect(isRightPaneGesture(gesture({ button: 1 }))).toBe(false);
    expect(isRightPaneGesture(gesture({ shiftKey: false }))).toBe(false);
    expect(isRightPaneGesture(gesture({ altKey: true }))).toBe(false);
    expect(isRightPaneGesture(gesture({ ctrlKey: true }))).toBe(false);
    expect(isRightPaneGesture(gesture({ metaKey: true }))).toBe(false);
  });
});
