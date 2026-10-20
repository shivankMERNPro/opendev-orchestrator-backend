type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
  });

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(message: string): void {
    write('info', message);
  },
  warn(message: string): void {
    write('warn', message);
  },
  error(message: string): void {
    write('error', message);
  },
};
