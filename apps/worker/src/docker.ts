import Docker from "dockerode";

/**
 * Defaults to /var/run/docker.sock (Linux socket, bind-mounted into this container).
 * DOCKER_HOST, if set, overrides via dockerode's own env handling.
 */
export const docker = new Docker(
  process.env.DOCKER_SOCKET_PATH ? { socketPath: process.env.DOCKER_SOCKET_PATH } : undefined,
);
