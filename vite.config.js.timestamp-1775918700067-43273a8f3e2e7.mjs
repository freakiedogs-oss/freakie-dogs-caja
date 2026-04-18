import "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import.meta.url;
//#endregion
//#region vite.config.js
const __vite_injected_original_dirname = "/sessions/fervent-dazzling-ptolemy/mnt/Freakie Dogs ERP/vercel-deploy";
var vite_config_default = defineConfig({
	plugins: [react()],
	build: {
		outDir: "dist",
		sourcemap: false,
		rollupOptions: { input: {
			main: resolve(__vite_injected_original_dirname, "index.html"),
			pos: resolve(__vite_injected_original_dirname, "pos.html")
		} }
	}
});
//#endregion
export { vite_config_default as default };

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZS5jb25maWcuanMiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Nlc3Npb25zL2ZlcnZlbnQtZGF6emxpbmctcHRvbGVteS9tbnQvRnJlYWtpZSBEb2dzIEVSUC92ZXJjZWwtZGVwbG95L3ZpdGUuY29uZmlnLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnXG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnXG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAncGF0aCdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICBidWlsZDoge1xuICAgIG91dERpcjogJ2Rpc3QnLFxuICAgIHNvdXJjZW1hcDogZmFsc2UsXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgaW5wdXQ6IHtcbiAgICAgICAgbWFpbjogcmVzb2x2ZShfX2Rpcm5hbWUsICdpbmRleC5odG1sJyksXG4gICAgICAgIHBvczogIHJlc29sdmUoX19kaXJuYW1lLCAncG9zLmh0bWwnKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pXG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQSxNQUFNLG1DQUE0QjtBQUlsQyxJQUFBLHNCQUFlLGFBQWE7Q0FDMUIsU0FBUyxDQUFDLE9BQU8sQ0FBQztDQUNsQixPQUFPO0VBQ0wsUUFBUTtFQUNSLFdBQVc7RUFDWCxlQUFlLEVBQ2IsT0FBTztHQUNMLE1BQU0sUUFBQSxrQ0FBbUIsYUFBYTtHQUN0QyxLQUFNLFFBQUEsa0NBQW1CLFdBQVc7R0FDckMsRUFDRjtFQUNGO0NBQ0YsQ0FBQSJ9