import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createStateStore(rootDir) {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(rootDir, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new DatabaseSync(path.join(dataDir, 'app.sqlite'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      edit_code_hash TEXT NOT NULL UNIQUE,
      view_code_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_states (
      workspace_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);

  const getWorkspaceStatement = db.prepare(`
    SELECT id, name, created_at, updated_at
    FROM workspaces
    WHERE id = ?
  `);
  const findWorkspaceByCodeStatement = db.prepare(`
    SELECT id, name, created_at, updated_at,
      CASE
        WHEN edit_code_hash = ? THEN 'editor'
        WHEN view_code_hash = ? THEN 'viewer'
      END AS role
    FROM workspaces
    WHERE edit_code_hash = ? OR view_code_hash = ?
    LIMIT 1
  `);
  const createWorkspaceStatement = db.prepare(`
    INSERT INTO workspaces (id, name, edit_code_hash, view_code_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateWorkspaceStatement = db.prepare(`
    UPDATE workspaces
    SET name = ?, updated_at = ?
    WHERE id = ?
  `);
  const getStateStatement = db.prepare(`
    SELECT state_json, version, updated_at
    FROM workspace_states
    WHERE workspace_id = ?
  `);
  const upsertStateStatement = db.prepare(`
    INSERT INTO workspace_states (workspace_id, state_json, version, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      state_json = excluded.state_json,
      version = workspace_states.version + 1,
      updated_at = excluded.updated_at
  `);
  const deleteStateStatement = db.prepare(`
    DELETE FROM workspace_states
    WHERE workspace_id = ?
  `);
  const rotateEditCodeStatement = db.prepare(`
    UPDATE workspaces
    SET edit_code_hash = ?, updated_at = ?
    WHERE id = ?
  `);
  const rotateViewCodeStatement = db.prepare(`
    UPDATE workspaces
    SET view_code_hash = ?, updated_at = ?
    WHERE id = ?
  `);

  return {
    createWorkspace(name, initialState = null) {
      const now = new Date().toISOString();
      const id = `ws_${randomToken(16).toLowerCase()}`;
      const editCode = createWorkspaceCode('EDIT');
      const viewCode = createWorkspaceCode('VIEW');
      createWorkspaceStatement.run(id, normalizeWorkspaceName(name), hashCode(editCode), hashCode(viewCode), now, now);
      if (initialState) {
        upsertStateStatement.run(id, JSON.stringify(initialState), now);
      }
      return {
        workspace: {
          id,
          name: normalizeWorkspaceName(name),
          role: 'editor',
          createdAt: now,
          updatedAt: now,
        },
        editCode,
        viewCode,
        ...readWorkspaceState(id),
      };
    },

    joinWorkspace(code) {
      const codeHash = hashCode(code);
      const workspace = findWorkspaceByCodeStatement.get(codeHash, codeHash, codeHash, codeHash);
      if (!workspace?.role) {
        return null;
      }
      return {
        workspace: mapWorkspace(workspace),
        ...readWorkspaceState(workspace.id),
      };
    },

    getWorkspaceState(workspaceId, code) {
      const workspace = authorizeWorkspace(workspaceId, code, 'viewer');
      return {
        workspace,
        ...readWorkspaceState(workspaceId),
      };
    },

    saveWorkspaceState(workspaceId, code, state, expectedVersion = null) {
      const workspace = authorizeWorkspace(workspaceId, code, 'editor');
      const current = readWorkspaceState(workspaceId);
      if (
        Number.isInteger(expectedVersion) &&
        current.version > 0 &&
        expectedVersion !== current.version
      ) {
        const error = new Error('工作区已被别人更新，请先载入最新版本');
        error.statusCode = 409;
        throw error;
      }
      const updatedAt = new Date().toISOString();
      upsertStateStatement.run(workspaceId, JSON.stringify(state), updatedAt);
      return {
        workspace,
        ...readWorkspaceState(workspaceId),
      };
    },

    resetWorkspaceState(workspaceId, code) {
      const workspace = authorizeWorkspace(workspaceId, code, 'editor');
      deleteStateStatement.run(workspaceId);
      return {
        workspace,
        state: null,
        version: 0,
        updatedAt: null,
      };
    },

    updateWorkspace(workspaceId, code, name) {
      const workspace = authorizeWorkspace(workspaceId, code, 'editor');
      const updatedAt = new Date().toISOString();
      updateWorkspaceStatement.run(normalizeWorkspaceName(name), updatedAt, workspace.id);
      return mapWorkspace(getWorkspaceStatement.get(workspace.id), workspace.role);
    },

    rotateWorkspaceCode(workspaceId, code, role) {
      const workspace = authorizeWorkspace(workspaceId, code, 'editor');
      const nextCode = createWorkspaceCode(role === 'viewer' ? 'VIEW' : 'EDIT');
      const updatedAt = new Date().toISOString();
      if (role === 'viewer') {
        rotateViewCodeStatement.run(hashCode(nextCode), updatedAt, workspace.id);
      } else {
        rotateEditCodeStatement.run(hashCode(nextCode), updatedAt, workspace.id);
      }
      return {
        workspace: mapWorkspace(getWorkspaceStatement.get(workspace.id), workspace.role),
        role: role === 'viewer' ? 'viewer' : 'editor',
        code: nextCode,
      };
    },
  };

  function readWorkspaceState(workspaceId) {
    const row = getStateStatement.get(workspaceId);
    if (!row) {
      return {
        state: null,
        version: 0,
        updatedAt: null,
      };
    }
    return {
      state: JSON.parse(row.state_json),
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  function authorizeWorkspace(workspaceId, code, minimumRole) {
    const joined = joinByCode(code);
    if (!joined || joined.workspace.id !== workspaceId) {
      const error = new Error('工作区代码无效');
      error.statusCode = 401;
      throw error;
    }
    if (minimumRole === 'editor' && joined.workspace.role !== 'editor') {
      const error = new Error('当前工作区代码只有只读权限');
      error.statusCode = 403;
      throw error;
    }
    return joined.workspace;
  }

  function joinByCode(code) {
    const codeHash = hashCode(code);
    const workspace = findWorkspaceByCodeStatement.get(codeHash, codeHash, codeHash, codeHash);
    if (!workspace?.role) {
      return null;
    }
    return {
      workspace: mapWorkspace(workspace),
      ...readWorkspaceState(workspace.id),
    };
  }
}

export function hashCode(code) {
  return createHash('sha256').update(normalizeCode(code)).digest('hex');
}

function normalizeWorkspaceName(name) {
  const clean = String(name ?? '').trim();
  return clean || '我的工作区';
}

function normalizeCode(code) {
  return String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function createWorkspaceCode(prefix) {
  return `${prefix}-${randomToken(4)}-${randomToken(4)}-${randomToken(4)}`;
}

function randomToken(length) {
  const bytes = randomBytes(length);
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += codeAlphabet[bytes[index] % codeAlphabet.length];
  }
  return value;
}

function mapWorkspace(row, role = row.role) {
  return {
    id: row.id,
    name: row.name,
    role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
