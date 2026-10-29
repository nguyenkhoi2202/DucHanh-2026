# Nha Khoa Đức Hạnh – Quản lý hồ sơ bệnh nhân

React + Vite (giao diện) và Express + SQLite (máy chủ, dùng `node:sqlite` có sẵn trong Node).
Mọi máy mở web đều đọc/ghi cùng một cơ sở dữ liệu và tự cập nhật khi máy khác thay đổi dữ liệu.

## Chạy

Yêu cầu: Node.js 22.13 trở lên.

```bash
npm install
cp .env.example .env      # rồi đặt APP_PASSWORD và thông tin ngân hàng
npm run dev               # chạy thử, có tự tải lại khi sửa code
```

Chạy thật (máy ở phòng khám):

```bash
npm run build
npm start
```

Mở `http://localhost:3000`, hoặc từ máy khác cùng mạng: `http://<IP-máy-chủ>:3000`.

## Triển khai lên server (Docker + Cloudflare Tunnel)

Web chạy trong Docker, ra Internet qua tunnel `duchanh` → `https://duchanh.khoitn.io.vn`
(server không cần mở cổng nào). Cần: server Linux có Docker, đăng nhập SSH bằng key.

```bash
scripts/deploy.sh user@server --with-db   # lần đầu: kèm bản sao DB hiện tại
scripts/deploy.sh user@server             # các lần sau: chỉ cập nhật code, giữ nguyên DB trên server
```

`deploy/cloudflared/` (thông tin đăng nhập tunnel) và `.env` không nằm trong git; giữ bí mật.
Dữ liệu trên server nằm ở `~/duchanh/data/duchanh.db`.

### Sao lưu tự động

Cron trên server chạy `scripts/backup-db.sh` lúc 02:00 giờ VN mỗi ngày: chụp DB khi đang chạy, kiểm tra
toàn vẹn, nén vào `~/duchanh-backups/duchanh-YYYYMMDD-HHMMSS.db.gz`, giữ 30 ngày. Nhật ký: `~/duchanh-backups/backup.log`.

Khôi phục một bản sao lưu:

```bash
cd ~/duchanh && docker compose stop app
gunzip -c ~/duchanh-backups/duchanh-<ngày-giờ>.db.gz > data/duchanh.db && rm -f data/duchanh.db-wal data/duchanh.db-shm
docker compose start app
```

## Dữ liệu

- Toàn bộ dữ liệu nằm trong file `data/duchanh.db`. **Sao lưu file này định kỳ** (copy khi đang chạy vẫn được,
  nhưng an toàn nhất là dùng nút "Tải backup toàn bộ" trên web).
- Lần đầu đăng nhập, nếu trình duyệt còn dữ liệu của phiên bản cũ (localStorage), web sẽ hỏi để chuyển sang.
- Dữ liệu từ file backup JSON cũ (hoặc file tải từ Google Script cũ) nhập bằng nút "Nhập dữ liệu từ file backup".

## Thanh toán QR + SePay

Luồng: bấm tạo QR (theo "Còn nợ" hoặc số tự nhập) → khách quét và chuyển khoản → SePay báo về web →
popup QR tự chuyển sang màn hình **"Thanh toán thành công"** (có âm báo) trên mọi máy đang mở web.

Mỗi mã QR có một mã riêng (vd. `DH1A2B3C4D5E`) trong nội dung chuyển khoản; web chỉ báo thành công khi
nội dung có đúng mã đó **và** số tiền ≥ số tiền yêu cầu. SePay gửi trùng giao dịch cũng không bị tính 2 lần.

### Cài đặt SePay (một lần)

1. Đăng ký tại https://my.sepay.vn (gói Free: 50 giao dịch/tháng) và liên kết tài khoản ngân hàng nhận tiền.
   SePay chỉ hỗ trợ: Vietcombank, VPBank, ACB, Sacombank, VietinBank, MB Bank, BIDV, MSB, TPBank,
   KienLongBank, Shinhan Bank, OCB (**không có VIB**).
2. Sửa `.env` cho đúng tài khoản vừa liên kết: `BANK_CODE` (vd. `MB`), `BANK_NAME`, `BANK_ACCOUNT_NO`,
   `BANK_ACCOUNT_NAME`. Mã ngân hàng xem tại https://qr.sepay.vn/banks.json
3. Đưa web ra Internet để SePay gọi được (máy ở phòng khám dùng Cloudflare Tunnel, miễn phí):
   ```bash
   brew install cloudflared
   cloudflared tunnel --url http://localhost:3000     # in ra địa chỉ https://....trycloudflare.com
   ```
   Địa chỉ `trycloudflare.com` đổi mỗi lần chạy; để dùng lâu dài nên tạo "named tunnel" với tên miền riêng.
   **Trước khi mở ra Internet phải đổi `APP_PASSWORD`** (bản chạy thật bắt buộc ≥ 8 ký tự).
4. Trong SePay → Tích hợp Webhooks → Thêm webhook:
   - Sự kiện: Có tiền vào
   - URL: `https://<địa-chỉ-ở-bước-3>/api/sepay/webhook`
   - Kiểu chứng thực: **API Key**, giá trị = `SEPAY_API_KEY` trong `.env`
   - Nếu có tuỳ chọn bỏ qua giao dịch không có "code thanh toán", chọn **Không** bỏ qua
     (web tự tìm mã `DH...` trong nội dung chuyển khoản).

   Tiền vào tài khoản mà nội dung không có mã `DH...` đang chờ (vd. người thân chuyển) bị web bỏ qua
   và **không lưu lại**. Một mã có thể trả làm nhiều lần chuyển; web báo thành công khi tổng đủ số tiền.

### Thử mà không cần chuyển tiền thật

Tạo một mã QR trên web, rồi chạy (thay mã và số tiền):

```bash
npm run sepay:simulate -- DH1A2B3C4D5E 450000
```
