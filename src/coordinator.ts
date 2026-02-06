import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeLog } from "./logger.js";

interface LockRecord {
  pid: number;
  ownerId: string;
  acquiredAt: number;
  heartbeatAt: number;
  cwd: string;
}

interface InternalLease {
  slot: number;
  lockPath: string;
  timer: NodeJS.Timeout;
}

export interface GlobalCoordinatorConfig {
  maxSlots: number;
  leaseMs: number;
  heartbeatMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  lockDir?: string;
}

export interface GlobalLease {
  slot: number;
  lockPath: string;
  ownerId: string;
}

export class GlobalConcurrencyCoordinator {
  private readonly lockDir: string;
  private readonly ownerId: string;
  private readonly activeLeases = new Map<string, InternalLease>();
  private hooksInstalled = false;

  constructor(private readonly config: GlobalCoordinatorConfig) {
    this.lockDir =
      config.lockDir ||
      path.join(os.homedir(), ".huge-ai-search", "coordinator", "google-search-slots");
    this.ownerId = `pid_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    this.ensureLockDir();
    this.cleanupStaleSlotsSync();
    this.installProcessHooks();
  }

  getLockDir(): string {
    return this.lockDir;
  }

  async acquire(waitTimeoutMs: number): Promise<GlobalLease | null> {
    const start = Date.now();
    let attempt = 0;

    while (Date.now() - start < waitTimeoutMs) {
      for (let slot = 1; slot <= this.config.maxSlots; slot++) {
        const lease = this.tryAcquireSlot(slot);
        if (lease) {
          return lease;
        }
      }

      attempt++;
      const backoff = Math.min(
        this.config.retryBaseMs * Math.max(1, attempt),
        this.config.retryMaxMs
      );
      const jitter = Math.floor(Math.random() * 120);
      await sleep(backoff + jitter);
    }

    return null;
  }

  async release(lease: GlobalLease): Promise<void> {
    const key = this.leaseKey(lease.slot, lease.lockPath);
    const internal = this.activeLeases.get(key);
    if (internal) {
      clearInterval(internal.timer);
      this.activeLeases.delete(key);
    }

    await this.unlinkWithRetry(lease.lockPath);
  }

  private ensureLockDir(): void {
    try {
      if (!fs.existsSync(this.lockDir)) {
        fs.mkdirSync(this.lockDir, { recursive: true });
      }
    } catch (error) {
      this.log("ERROR", `创建协调目录失败: ${error}`);
    }
  }

  private tryAcquireSlot(slot: number): GlobalLease | null {
    const lockPath = path.join(this.lockDir, `slot_${slot}.lock`);

    if (this.tryCreateLockFile(lockPath)) {
      return this.startLease(slot, lockPath);
    }

    // 文件已存在时，尝试清理 stale 锁并重试一次
    if (this.isLockStale(lockPath)) {
      this.safeUnlinkSync(lockPath);
      if (this.tryCreateLockFile(lockPath)) {
        return this.startLease(slot, lockPath);
      }
    }

    return null;
  }

  private tryCreateLockFile(lockPath: string): boolean {
    try {
      const record = this.buildRecord();
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, JSON.stringify(record), { encoding: "utf8" });
      fs.closeSync(fd);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        this.log("DEBUG", `创建锁文件失败: ${lockPath}, code=${code || "N/A"}`);
      }
      return false;
    }
  }

  private startLease(slot: number, lockPath: string): GlobalLease {
    const lease: GlobalLease = { slot, lockPath, ownerId: this.ownerId };
    const key = this.leaseKey(slot, lockPath);
    const timer = setInterval(() => {
      this.touchLease(lockPath);
    }, this.config.heartbeatMs);
    timer.unref?.();
    this.activeLeases.set(key, { slot, lockPath, timer });
    this.log("DEBUG", `获取全局槽位: ${slot}/${this.config.maxSlots}`);
    return lease;
  }

  private touchLease(lockPath: string): void {
    try {
      const current = this.readRecord(lockPath);
      if (!current || current.ownerId !== this.ownerId || current.pid !== process.pid) {
        return;
      }
      const next: LockRecord = {
        ...current,
        heartbeatAt: Date.now(),
      };
      fs.writeFileSync(lockPath, JSON.stringify(next), { encoding: "utf8" });
    } catch {
      // ignore
    }
  }

  private isLockStale(lockPath: string): boolean {
    const record = this.readRecord(lockPath);
    if (!record) {
      return true;
    }

    const now = Date.now();
    const leaseExpired = now - record.heartbeatAt > this.config.leaseMs;
    if (leaseExpired) {
      this.log("DEBUG", `检测到过期锁: ${path.basename(lockPath)}`);
      return true;
    }

    if (!this.isProcessAlive(record.pid)) {
      this.log("DEBUG", `检测到僵尸锁: ${path.basename(lockPath)} pid=${record.pid}`);
      return true;
    }

    return false;
  }

  private readRecord(lockPath: string): LockRecord | null {
    try {
      const raw = fs.readFileSync(lockPath, { encoding: "utf8" }).trim();
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as LockRecord;
      if (
        typeof parsed.pid !== "number" ||
        typeof parsed.ownerId !== "string" ||
        typeof parsed.acquiredAt !== "number" ||
        typeof parsed.heartbeatAt !== "number"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EPERM 表示进程存在但无权限发信号
      return code === "EPERM";
    }
  }

  private buildRecord(): LockRecord {
    const now = Date.now();
    return {
      pid: process.pid,
      ownerId: this.ownerId,
      acquiredAt: now,
      heartbeatAt: now,
      cwd: process.cwd(),
    };
  }

  private safeUnlinkSync(lockPath: string): void {
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        this.log("DEBUG", `清理锁文件失败: ${lockPath}, code=${code || "N/A"}`);
      }
    }
  }

  private async unlinkWithRetry(lockPath: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.unlinkSync(lockPath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return;
        }
        if (code !== "EBUSY" && code !== "EPERM") {
          return;
        }
      }
      await sleep(20 + attempt * 40);
    }
  }

  private cleanupStaleSlotsSync(): void {
    for (let slot = 1; slot <= this.config.maxSlots; slot++) {
      const lockPath = path.join(this.lockDir, `slot_${slot}.lock`);
      if (!fs.existsSync(lockPath)) {
        continue;
      }
      if (this.isLockStale(lockPath)) {
        this.safeUnlinkSync(lockPath);
      }
    }
  }

  private installProcessHooks(): void {
    if (this.hooksInstalled) {
      return;
    }

    const releaseAll = () => {
      for (const lease of this.activeLeases.values()) {
        clearInterval(lease.timer);
        this.safeUnlinkSync(lease.lockPath);
      }
      this.activeLeases.clear();
    };

    process.on("exit", releaseAll);
    process.on("SIGINT", () => {
      releaseAll();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      releaseAll();
      process.exit(143);
    });

    this.hooksInstalled = true;
  }

  private leaseKey(slot: number, lockPath: string): string {
    return `${slot}:${lockPath}`;
  }

  private log(level: "INFO" | "ERROR" | "DEBUG", message: string): void {
    writeLog(level, message, "Coordinator");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
