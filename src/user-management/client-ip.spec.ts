import { publicClientIp } from './client-ip';
describe('public client IP evidence', () => {
  it.each(['172.18.0.11', '10.0.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1',
    '100.64.0.1', '203.0.113.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1',
    '::ffff:172.18.0.11', '2001:db8::1', 'not-an-ip', ''])('rejects non-public source %s', address => {
    expect(publicClientIp(address)).toBeNull();
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public source %s', address => {
    expect(publicClientIp(address)).toBe(address);
  });
  it('normalizes IPv4-mapped IPv6 before classification', () => {
    expect(publicClientIp('::ffff:8.8.8.8')).toBe('8.8.8.8');
  });
});
