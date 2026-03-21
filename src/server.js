
async function fetch(request, env, ctx) {
    return new Response("Hello World!");
}

const server = {
    fetch
};

export default server;
