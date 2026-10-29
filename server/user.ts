// Manage login accounts.
//   Local:       npm run user -- list
//                npm run user -- set <username> <password> <clinic-slug>
//   On server:   docker exec duchanh-app node dist-server/user.js set <username> <password> <clinic-slug>
// Clinic slugs: binh-thuan, cu-bao
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const { listClinics, listUsers, setUser } = await import('./db');

const [command, username, password, clinicSlug] = process.argv.slice(2);

if (command === 'list') {
  console.log('Nha khoa:', listClinics().map((c) => `${c.slug} (${c.name})`).join(', '));
  console.table(listUsers());
} else if (command === 'set' && username && password && clinicSlug) {
  if (password.length < 8) {
    console.error('Mật khẩu phải có ít nhất 8 ký tự');
    process.exit(1);
  }
  setUser(username, password, clinicSlug);
  console.log(`Đã lưu tài khoản "${username}" cho nha khoa ${clinicSlug}`);
} else {
  console.error('Cách dùng: user list | user set <tên-đăng-nhập> <mật-khẩu> <binh-thuan|cu-bao>');
  process.exit(1);
}
