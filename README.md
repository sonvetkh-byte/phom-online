# Phỏm Online

Game bài Phỏm (Tá lả) chơi nhiều người qua mạng. Tạo phòng, gửi mã hoặc link cho bạn bè. Ghế trống có người máy ngồi thay.

- Máy chủ giữ toàn bộ luật và chia bài, nên người chơi không xem được bài của nhau.
- Mỗi lượt có 30 giây. Hết giờ hoặc rớt mạng thì máy đánh hộ.
- Rớt mạng hay tải lại trang vẫn vào lại đúng ghế cũ.
- Bạn bè có thể vào giữa chừng, ngồi thay ghế người máy.
- Có thả cảm xúc 👍 😂 😮 😡 🙏 🔥 trong ván.
- Không cần cài thư viện nào. Chỉ cần Node.js 18 trở lên.

## Chạy thử trên máy tính

```
node server.js
```

Mở http://localhost:3000 trên trình duyệt. Muốn chơi với điện thoại cùng mạng Wi-Fi, mở `http://<địa-chỉ-IP-máy-tính>:3000` trên điện thoại.

## Đưa lên mạng miễn phí với Render

1. Tạo tài khoản GitHub, tạo một repository mới và tải toàn bộ thư mục này lên.
2. Vào https://render.com, đăng nhập bằng GitHub.
3. Bấm **New → Web Service** và chọn repository vừa tạo.
4. Điền:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Bấm **Create Web Service**. Vài phút sau bạn có link dạng `https://phom-xxxx.onrender.com`. Gửi link này cho bạn bè là chơi được.

Lưu ý gói miễn phí của Render:
- Máy chủ tự ngủ sau khoảng 15 phút không ai chơi. Lần mở đầu tiên sau đó mất khoảng 30–60 giây để khởi động lại.
- Khi máy chủ khởi động lại, các phòng đang có sẽ mất. Xu chỉ lưu trong phòng, không lưu vĩnh viễn.

## Host khác

Chạy được trên bất kỳ host nào hỗ trợ Node.js và WebSocket, ví dụ Railway, Fly.io, hoặc VPS riêng. Máy chủ đọc cổng từ biến môi trường `PORT`.

Không dùng được Netlify hay GitHub Pages, vì hai nơi này chỉ chứa web tĩnh, không chạy được máy chủ.

## Các file

- `server.js`: máy chủ, quản lý phòng, lượt chơi, người máy, tính xu.
- `miniws.js`: phần WebSocket viết bằng Node thuần.
- `public/game.js`: luật Phỏm, dùng chung cho máy chủ và trình duyệt.
- `public/index.html`: giao diện trên điện thoại.

## Chỉnh nhanh

Trong `server.js`:
- `TURN_MS`: thời gian mỗi lượt, mặc định 30 giây.
- `OFFLINE_MS`: thời gian chờ người rớt mạng trước khi máy đánh hộ.
- `START_CHIPS`: số xu lúc vào phòng.
- `BOT_NAMES`: tên người máy.

Xu chỉ để tính điểm cho vui, không phải tiền thật.
