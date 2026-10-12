import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class ConfigManager {
  static getConfigPath() {
    if (process.env.AGENT_SYNC_CONFIG) {
      return path.resolve(process.env.AGENT_SYNC_CONFIG);
    }
    // 优先使用当前项目工作区根目录的 sync-config.json
    const localWorkspaceConfig = path.resolve('sync-config.json');
    if (fs.existsSync(localWorkspaceConfig)) {
      return localWorkspaceConfig;
    }
    return localWorkspaceConfig;
  }

  static loadConfig() {
    const configPath = this.getConfigPath();
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch {}
    }

    const defaultDeviceId = os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return {
      version: 1,
      currentDeviceId: defaultDeviceId,
      devices: {
        [defaultDeviceId]: {
          name: `${os.hostname()} (${os.platform()})`,
          os: os.platform(),
          shell: os.platform() === 'win32' ? 'powershell' : 'bash'
        }
      },
      projectMappings: []
    };
  }

  static saveConfig(cfg) {
    const configPath = this.getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  }

  static registerDevice(deviceId, name) {
    const cfg = this.loadConfig();
    cfg.devices[deviceId] = {
      name,
      os: os.platform(),
      shell: os.platform() === 'win32' ? 'powershell' : 'bash'
    };
    this.saveConfig(cfg);
    return cfg;
  }

  static addProjectMapping(projectId, devicePaths, gitRemote) {
    const cfg = this.loadConfig();
    let existing = cfg.projectMappings.find(p => p.projectId === projectId);
    if (!existing) {
      existing = { projectId, gitRemote, paths: {} };
      cfg.projectMappings.push(existing);
    }
    if (gitRemote) existing.gitRemote = gitRemote;
    existing.paths = { ...existing.paths, ...devicePaths };
    this.saveConfig(cfg);
    return cfg;
  }

  static resolveTargetProjectRoot(sourceProjectRoot, targetDeviceId, gitRemote) {
    const cfg = this.loadConfig();
    if (gitRemote) {
      const match = cfg.projectMappings.find(m => m.gitRemote && m.gitRemote.toLowerCase() === gitRemote.toLowerCase());
      if (match && match.paths[targetDeviceId]) {
        return match.paths[targetDeviceId];
      }
    }

    const normalizedSource = sourceProjectRoot.replace(/[\\/]+/g, '/').toLowerCase();
    for (const mapping of cfg.projectMappings) {
      for (const devPath of Object.values(mapping.paths)) {
        if (devPath.replace(/[\\/]+/g, '/').toLowerCase() === normalizedSource) {
          if (mapping.paths[targetDeviceId]) {
            return mapping.paths[targetDeviceId];
          }
        }
      }
    }

    return null;
  }
}
