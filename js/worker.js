import { solve } from "./model.js";

self.onmessage = ({ data }) => {
  try {
    const result = solve(data, iterations => self.postMessage({ iterations }));
    self.postMessage({ result }, [result.bias.buffer, ...result.policies.map(p => p.buffer)]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
