const test=require("node:test"),assert=require("node:assert/strict"),{proxyForWebSocket:proxy}=require("../../src/pro/network.cjs");
test("public WSS retains HTTPS proxy while explicit loopback exceptions stay local",()=>{
 const env={HTTPS_PROXY:"http://proxy.invalid:8080",NO_PROXY:"127.0.0.1,localhost:1884,[::1],.example.invalid"};
 assert.equal(proxy("wss://broker.emqx.io:8084/mqtt",env),env.HTTPS_PROXY);
 for(const u of ["wss://127.0.0.1:1884/mqtt","wss://localhost:1884/mqtt","wss://[::1]/mqtt","wss://lab.example.invalid/mqtt"])assert.equal(proxy(u,env),undefined);
 assert.equal(proxy("wss://localhost:8084/mqtt",env),env.HTTPS_PROXY);
 assert.equal(proxy("wss://notexample.invalid/mqtt",env),env.HTTPS_PROXY);
});
