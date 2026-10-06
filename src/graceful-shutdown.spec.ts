import { closeAfterJobs } from './graceful-shutdown';

describe('production job draining', () => {
  it('keeps database/application resources open until both workers finish', async () => {
    let finishMail!: () => void;
    let finishCv!: () => void;
    const mail = { close: jest.fn(() => new Promise<void>(resolve => { finishMail = resolve; })) };
    const cv = { close: jest.fn(() => new Promise<void>(resolve => { finishCv = resolve; })) };
    const close = jest.fn().mockResolvedValue(undefined);
    const drained = closeAfterJobs([mail, cv], close);
    expect(mail.close).toHaveBeenCalled();
    expect(cv.close).toHaveBeenCalled();
    finishMail();
    await Promise.resolve();
    expect(close).not.toHaveBeenCalled();
    finishCv();
    await drained;
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('does not disconnect resources if a worker fails to drain', async () => {
    const close = jest.fn();
    await expect(closeAfterJobs([{ close: async () => { throw Error('job still running'); } }], close)).rejects.toThrow('job still running');
    expect(close).not.toHaveBeenCalled();
  });
});
