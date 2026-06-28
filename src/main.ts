import "./styles/global.css";
import { Router } from "./router";

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app container not found");
}

new Router(root).start();
