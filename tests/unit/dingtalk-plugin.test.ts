import { describe, expect, it } from 'vitest';
import {
  hasDingTalkConfigReferences,
  resolveDingTalkPluginCandidateSources,
} from '@electron/utils/dingtalk-plugin';

describe('dingtalk plugin compatibility utilities', () => {
  describe('hasDingTalkConfigReferences', () => {
    it('detects dingtalk channel config', () => {
      expect(
        hasDingTalkConfigReferences({
          channels: {
            dingtalk: { enabled: true },
          },
        }),
      ).toBe(true);
    });

    it('detects dingtalk plugins.allow entry', () => {
      expect(
        hasDingTalkConfigReferences({
          plugins: {
            allow: ['discord', 'dingtalk'],
          },
        }),
      ).toBe(true);
    });

    it('returns false when dingtalk is not referenced', () => {
      expect(
        hasDingTalkConfigReferences({
          channels: {
            telegram: { enabled: true },
          },
          plugins: {
            allow: ['discord'],
          },
        }),
      ).toBe(false);
    });
  });

  describe('resolveDingTalkPluginCandidateSources', () => {
    it('builds packaged candidate source paths', () => {
      const candidates = resolveDingTalkPluginCandidateSources({
        isPackaged: true,
        resourcesPath: '/Applications/ClawX.app/Contents/Resources',
        appPath: '/Applications/ClawX.app/Contents/Resources/app.asar',
        cwd: '/tmp/irrelevant',
        currentDir: '/tmp/irrelevant',
      });

      expect(candidates).toEqual([
        '/Applications/ClawX.app/Contents/Resources/openclaw-plugins/dingtalk',
        '/Applications/ClawX.app/Contents/Resources/app.asar.unpacked/build/openclaw-plugins/dingtalk',
        '/Applications/ClawX.app/Contents/Resources/app.asar.unpacked/openclaw-plugins/dingtalk',
      ]);
    });

    it('builds development candidate source paths', () => {
      const candidates = resolveDingTalkPluginCandidateSources({
        isPackaged: false,
        resourcesPath: '/tmp/irrelevant',
        appPath: '/workspace',
        cwd: '/workspace',
        currentDir: '/workspace/dist-electron/utils',
      });

      expect(candidates).toEqual([
        '/workspace/build/openclaw-plugins/dingtalk',
        '/workspace/build/openclaw-plugins/dingtalk',
        '/workspace/build/openclaw-plugins/dingtalk',
      ]);
    });
  });
});
