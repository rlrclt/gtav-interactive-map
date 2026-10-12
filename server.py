import os
import json
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get('PORT', 8080))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'markers_data.json')

class SyncMapHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        if self.path == '/api/markers':
            self.handle_get_markers()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/markers':
            self.handle_post_markers()
        else:
            self.send_error(404, "Not Found")

    def handle_get_markers(self):
        markers = self.load_markers()
        payload = json.dumps({
            'serverTime': int(time.time() * 1000),
            'markers': markers
        }).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload)

    def handle_post_markers(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)

        try:
            req_json = json.loads(post_data.decode('utf-8'))
            markers = req_json.get('markers', [])
            self.save_markers(markers)

            response = json.dumps({'ok': True, 'count': len(markers)}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response)
        except Exception as e:
            self.send_error(400, f"Invalid JSON: {e}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    @staticmethod
    def load_markers():
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    @staticmethod
    def save_markers(markers):
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(markers, f, ensure_ascii=False, indent=2)

def main():
    server_address = ('0.0.0.0', PORT)
    httpd = ThreadingHTTPServer(server_address, SyncMapHandler)
    print(f"GTA V Map Server with Real-time Sync running on http://0.0.0.0:{PORT}")
    httpd.serve_forever()

if __name__ == '__main__':
    main()
