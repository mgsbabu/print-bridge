package `in`.tailorapp.printbridge

import java.io.BufferedInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The socket layer under [BridgeRouter]. Bound to 127.0.0.1 only, by contract with the backend: never 0.0.0.0.
 */
class BridgeHttpServer(
    private val router: BridgeRouter,
    private val port: Int = BridgeRouter.PORT,
) {
    private var workers: ExecutorService? = null
    @Volatile private var server: ServerSocket? = null

    companion object {
        private const val SOCKET_TIMEOUT_MS = 15_000
        private const val WORKERS = 8
    }

    /** Binds the port and starts accepting. Throws (e.g. BindException) if the port is taken. */
    @Synchronized
    fun start() {
        check(server == null) { "already started" }
        val s = ServerSocket(port, 16, InetAddress.getByName(BridgeRouter.HOST))
        s.reuseAddress = true
        val pool = Executors.newFixedThreadPool(WORKERS)
        server = s
        workers = pool
        Thread({
            while (!s.isClosed) {
                try {
                    val c = s.accept()
                    pool.execute { handle(c) }
                } catch (e: IOException) {
                    if (!s.isClosed) router.errors.add("accept failed: ${e.message}", null)
                } catch (e: java.util.concurrent.RejectedExecutionException) {
                    break
                }
            }
        }, "print-bridge-accept").start()
    }

    @Synchronized
    fun stop() {
        try {
            server?.close()
        } catch (e: IOException) {
            // Already closed; nothing to do.
        }
        server = null
        workers?.shutdownNow()
        workers = null
    }

    private fun handle(socket: Socket) {
        socket.use { s ->
            try {
                s.soTimeout = SOCKET_TIMEOUT_MS
                val res = try {
                    router.handle(HttpParser.read(BufferedInputStream(s.getInputStream())))
                } catch (e: HttpException) {
                    HttpResponse(e.status, org.json.JSONObject().put("error", e.message ?: "").put("errorCode", e.code))
                }
                s.getOutputStream().apply {
                    write(HttpParser.serialize(res))
                    flush()
                }
            } catch (e: SocketTimeoutException) {
                // Client went quiet mid-request; nothing useful to answer.
            } catch (e: IOException) {
                // Client hung up before reading the answer.
            }
        }
    }
}
