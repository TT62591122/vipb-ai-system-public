/**
 * WorkflowEngine - AI工作流编排引擎 (P2-12)
 * 
 * 基于 MatrixTaskEngine 的 Pipeline 模式，支持多步骤工作流定义与执行。
 * 按依赖拓扑排序执行 steps，每个 step 创建 matrix_task。
 */

const EventEmitter = require('events');

class WorkflowEngine extends EventEmitter {
  constructor(db, matrixEngine) {
    super();
    this.db = db;
    this.matrixEngine = matrixEngine;
    this._initTables();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        steps TEXT DEFAULT '[]',
        status TEXT DEFAULT 'draft',
        trigger_type TEXT DEFAULT 'manual',
        cron_expression TEXT,
        created_by TEXT DEFAULT 'manual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id INTEGER NOT NULL,
        status TEXT DEFAULT 'running',
        step_results TEXT DEFAULT '{}',
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_wf_status ON workflows(status);
      CREATE INDEX IF NOT EXISTS idx_wr_workflow ON workflow_runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_wr_status ON workflow_runs(status);
    `);
  }

  // ==================== CRUD ====================

  createWorkflow(data) {
    const stmt = this.db.prepare(`
      INSERT INTO workflows (name, description, steps, trigger_type, cron_expression, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.name,
      data.description || null,
      JSON.stringify(data.steps || []),
      data.trigger_type || 'manual',
      data.cron_expression || null,
      data.created_by || 'manual'
    );
    return this.getWorkflow(result.lastInsertRowid);
  }

  getWorkflow(id) {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!row) return null;
    row.steps = JSON.parse(row.steps || '[]');
    return row;
  }

  listWorkflows() {
    const rows = this.db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all();
    return rows.map(r => ({ ...r, steps: JSON.parse(r.steps || '[]') }));
  }

  updateWorkflow(id, data) {
    const fields = [];
    const values = [];
    for (const key of ['name', 'description', 'steps', 'status', 'trigger_type', 'cron_expression']) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'steps' ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (fields.length === 0) return this.getWorkflow(id);
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getWorkflow(id);
  }

  deleteWorkflow(id) {
    return this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  }

  // ==================== 执行 ====================

  /**
   * 拓扑排序 steps，按依赖顺序返回分层数组
   */
  _topoSort(steps) {
    const map = new Map(steps.map(s => [s.stepId, s]));
    const inDeg = new Map(steps.map(s => [s.stepId, (s.dependsOn || []).length]));
    const adj = new Map(steps.map(s => [s.stepId, []]));

    for (const s of steps) {
      for (const dep of (s.dependsOn || [])) {
        if (adj.has(dep)) adj.get(dep).push(s.stepId);
      }
    }

    const layers = [];
    let queue = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);

    while (queue.length > 0) {
      layers.push(queue.map(id => map.get(id)));
      const next = [];
      for (const id of queue) {
        for (const child of (adj.get(id) || [])) {
          inDeg.set(child, inDeg.get(child) - 1);
          if (inDeg.get(child) === 0) next.push(child);
        }
      }
      queue = next;
    }

    const sorted = layers.flat();
    if (sorted.length !== steps.length) {
      throw new Error('工作流存在循环依赖');
    }
    return layers;
  }

  async runWorkflow(workflowId) {
    const wf = this.getWorkflow(workflowId);
    if (!wf) throw new Error('工作流不存在');
    if (!wf.steps || wf.steps.length === 0) throw new Error('工作流没有步骤');

    // 创建 run 记录
    const run = this.db.prepare(
      "INSERT INTO workflow_runs (workflow_id, status) VALUES (?, 'running')"
    ).run(workflowId);
    const runId = run.lastInsertRowid;

    // 更新工作流状态
    this.db.prepare("UPDATE workflows SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(workflowId);

    const stepResults = {};
    const stepTaskMap = {}; // stepId → taskId

    try {
      const layers = this._topoSort(wf.steps);

      for (const layer of layers) {
        // 检查是否被暂停
        const currentRun = this.db.prepare('SELECT status FROM workflow_runs WHERE id = ?').get(runId);
        if (currentRun && currentRun.status === 'paused') {
          this.emit('workflow:paused', { runId, workflowId });
          return this.getWorkflowStatus(runId);
        }

        // 同一层可并行创建任务
        const taskPromises = layer.map(step => {
          // 确定 input_source_task_id
          let inputSourceTaskId = null;
          if (step.dependsOn && step.dependsOn.length > 0) {
            // 取第一个依赖的 taskId 作为 input source
            inputSourceTaskId = stepTaskMap[step.dependsOn[0]] || null;
          }

          const taskData = {
            task_type: step.taskType || 'workflow_step',
            platform: step.platform || 'system',
            action: step.action || 'execute',
            name: `WF-${workflowId}-${step.stepId}`,
            input_data: step.inputData || {},
            input_source_task_id: inputSourceTaskId,
            created_by: `workflow:${workflowId}:run:${runId}`
          };

          const task = this.matrixEngine.createTask(taskData);
          stepTaskMap[step.stepId] = task.lastInsertRowid;
          stepResults[step.stepId] = {
            taskId: task.lastInsertRowid,
            status: 'created'
          };

          // 更新 step_results
          this._updateRunResults(runId, stepResults);

          return { stepId: step.stepId, taskId: task.lastInsertRowid };
        });

        // 等待该层所有任务完成（轮询检查）
        await this._waitForTasks(taskPromises.map(t => t.taskId), runId);

        // 更新每个 step 的最终状态
        for (const { stepId, taskId } of taskPromises) {
          const task = this.db.prepare('SELECT status, output_data FROM matrix_tasks WHERE id = ?').get(taskId);
          stepResults[stepId] = {
            taskId,
            status: task ? task.status : 'unknown',
            output: task ? task.output_data : null
          };
          if (task && task.status === 'failed') {
            throw new Error(`步骤 ${stepId} (任务 ${taskId}) 执行失败`);
          }
        }
        this._updateRunResults(runId, stepResults);
      }

      // 完成
      this.db.prepare(
        "UPDATE workflow_runs SET status = 'completed', step_results = ?, completed_at = datetime('now') WHERE id = ?"
      ).run(JSON.stringify(stepResults), runId);
      this.db.prepare("UPDATE workflows SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(workflowId);
      this.emit('workflow:completed', { runId, workflowId });

    } catch (err) {
      this.db.prepare(
        "UPDATE workflow_runs SET status = 'failed', step_results = ?, error = ?, completed_at = datetime('now') WHERE id = ?"
      ).run(JSON.stringify(stepResults), err.message, runId);
      this.db.prepare("UPDATE workflows SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(workflowId);
      this.emit('workflow:failed', { runId, workflowId, error: err.message });
    }

    return this.getWorkflowStatus(runId);
  }

  async _waitForTasks(taskIds, runId, timeoutMs = 600000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // 检查暂停
      const run = this.db.prepare('SELECT status FROM workflow_runs WHERE id = ?').get(runId);
      if (run && run.status === 'paused') return;

      const placeholders = taskIds.map(() => '?').join(',');
      const pending = this.db.prepare(
        `SELECT COUNT(*) as c FROM matrix_tasks WHERE id IN (${placeholders}) AND status IN ('pending', 'running')`
      ).get(...taskIds);
      if (pending.c === 0) return;
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('等待任务超时');
  }

  _updateRunResults(runId, stepResults) {
    this.db.prepare("UPDATE workflow_runs SET step_results = ? WHERE id = ?")
      .run(JSON.stringify(stepResults), runId);
  }

  // ==================== 状态查询 ====================

  getWorkflowStatus(runId) {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId);
    if (!row) return null;
    row.step_results = JSON.parse(row.step_results || '{}');
    return row;
  }

  listRuns(workflowId) {
    const rows = this.db.prepare(
      'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC'
    ).all(workflowId);
    return rows.map(r => ({ ...r, step_results: JSON.parse(r.step_results || '{}') }));
  }

  // ==================== 暂停/恢复 ====================

  pauseWorkflow(runId) {
    const run = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId);
    if (!run || run.status !== 'running') throw new Error('只能暂停运行中的工作流');
    this.db.prepare("UPDATE workflow_runs SET status = 'paused' WHERE id = ?").run(runId);
    this.emit('workflow:paused', { runId, workflowId: run.workflow_id });
    return { ok: true, status: 'paused' };
  }

  resumeWorkflow(runId) {
    const run = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(runId);
    if (!run || run.status !== 'paused') throw new Error('只能恢复已暂停的工作流');
    this.db.prepare("UPDATE workflow_runs SET status = 'running' WHERE id = ?").run(runId);
    this.emit('workflow:resumed', { runId, workflowId: run.workflow_id });
    // 重新启动执行
    this.runWorkflow(run.workflow_id).catch(err => {
      console.error(`[WorkflowEngine] 恢复失败: ${err.message}`);
    });
    return { ok: true, status: 'running' };
  }
}

module.exports = WorkflowEngine;
