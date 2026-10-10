import { execFileSync, spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';

type Options = { cwd: string; env: NodeJS.ProcessEnv; timeout?: number; input?: string };

// 同期実行のタイムアウトでは孫プロセスが残るため、OS のプロセス群を停止する。
export function runProcess(file: string, args: string[], options: Options): Promise<string> {
  const taskkill = 'C:/Windows/System32/taskkill.exe';
  if (process.platform === 'win32') {
    if (
      realpathSync(taskkill).replaceAll('\\', '/').toLowerCase() !== taskkill.toLowerCase() ||
      !lstatSync(taskkill).isFile()
    )
      throw new Error('信頼する taskkill 実行ファイルの配置が不正です。');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== 'win32',
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stopped = false;
    let size = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const stop = (error: Error) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      try {
        if (child.pid) {
          if (process.platform === 'win32')
            execFileSync(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true,
              timeout: 5_000,
            });
          else process.kill(-child.pid, 'SIGKILL');
        }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') {
          child.kill('SIGKILL');
          error = new Error('プロセス群の停止に失敗しました。', { cause });
        }
      }
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      reject(error);
    };
    const timer = setTimeout(
      () => stop(Object.assign(new Error('実行時間の上限を超えました。'), { code: 'ETIMEDOUT' })),
      options.timeout ?? 60_000,
    );
    const collect = (target: Buffer[], data: Buffer) => {
      size += data.length;
      if (size > 1024 * 1024) stop(new Error('Git の出力が上限を超えました。'));
      else target.push(data);
    };
    child.stdout?.on('data', (data: Buffer) => collect(stdout, data));
    child.stderr?.on('data', (data: Buffer) => collect(stderr, data));
    child.on('error', stop);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (stopped) return;
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8').trim());
      else
        reject(
          Object.assign(new Error('コマンドが失敗しました。'), {
            code,
            signal,
            stderr: Buffer.concat(stderr).toString('utf8'),
          }),
        );
    });
    child.stdin?.on('error', stop);
    child.stdin?.end(options.input);
  });
}
