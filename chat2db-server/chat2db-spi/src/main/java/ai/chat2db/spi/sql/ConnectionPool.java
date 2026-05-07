package ai.chat2db.spi.sql;

import lombok.extern.slf4j.Slf4j;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Date;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
public class ConnectionPool {

    private static ConcurrentHashMap<String, ConnectInfo> CONNECTION_MAP = new ConcurrentHashMap<>();
    private static final int CONNECTION_VALID_TIMEOUT_SECONDS = 2;

    static {
        new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(1000 * 60 * 10);
                    log.info("CONNECTION_MAP size:{}",CONNECTION_MAP.size());
                    CONNECTION_MAP.forEach((k, v) -> {
                        log.info("CONNECTION_key:{},value:{}",k,v.getRefCount());
                        if (v.getLastAccessTime().getTime() + 1000 * 60 * 20 < System.currentTimeMillis() && v.getRefCount() == 0) {
                            try {
                                Connection connection = v.getConnection();
                                if (connection != null) {
                                    connection.close();
                                    CONNECTION_MAP.remove(k);
                                }
                            } catch (SQLException e) {
                                log.error("close connection error", e);
                            }
                        }
                    });
                } catch (InterruptedException e) {
                    log.error("close connection error", e);
                }
            }
        }).start();

    }

    public static synchronized void removeConnection(Long datasourceId) {
        CONNECTION_MAP.forEach((k, v) -> {
            if (k.contains(String.valueOf(datasourceId))) {
                try {
                    Connection connection = v.getConnection();
                    if (connection != null) {
                        connection.close();
                        CONNECTION_MAP.remove(k);
                    }
                } catch (SQLException e) {
                    log.error("close connection error", e);
                }
            }
        });
    }


    public static Connection getConnection(ConnectInfo connectInfo) {
        Connection connection = connectInfo.getConnection();
        if (isConnectionValid(connection)) {
            log.info("get connection from local");
            return connection;
        }
        closeQuietly(connection);
        connectInfo.setConnection(null);
        String key = connectInfo.getKey();
        ConnectInfo lock = CONNECTION_MAP.computeIfAbsent(key, k -> connectInfo.copy());
        try {
            synchronized (lock) {
                connection = connectInfo.getConnection();
                if (isConnectionValid(connection)) {
                    log.info("get connection from local");
                    return connection;
                }
                closeQuietly(connection);
                connectInfo.setConnection(null);

                int n = lock.incrementRefCount();
                if (n == 1) {
                    connection = lock.getConnection();
                    if (isConnectionValid(connection)) {
                        log.info("get connection from cache");
                        connectInfo.setConnection(connection);
                        lock.setLastAccessTime(new Date());
                        return connection;
                    } else {
                        closeQuietly(connection);
                        lock.setConnection(null);
                        log.info("get connection from db begin");
                        connection = Chat2DBContext.getDBManage().getConnection(connectInfo);
                        lock.setConnection(connection);
                        lock.setLastAccessTime(new Date());
                        log.info("get connection from db end");
                    }
                    connectInfo.setConnection(connection);
                    return connection;
                } else {
                    connection = Chat2DBContext.getDBManage().getConnection(connectInfo);
                    connectInfo.setConnection(connection);
                    return connection;
                }
            }
        } catch (Exception e) {
            log.error("get connection error", e);
            closeQuietly(connection);
        }
        return null;
    }

    private static boolean isConnectionValid(Connection connection) {
        try {
            return connection != null && !connection.isClosed() && connection.isValid(CONNECTION_VALID_TIMEOUT_SECONDS);
        } catch (SQLException e) {
            log.warn("connection validation failed", e);
            return false;
        }
    }

    private static void closeQuietly(Connection connection) {
        if (connection == null) {
            return;
        }
        try {
            if (!connection.isClosed()) {
                connection.close();
            }
        } catch (SQLException e) {
            log.warn("close invalid connection error", e);
        }
    }

    public static void close(ConnectInfo connectInfo) {
        String key = connectInfo.getKey();
        try {
            Connection currentConnection = connectInfo.getConnection();
            // 如果当前连接已经关闭，则不需要重复关闭
            if (currentConnection == null || currentConnection.isClosed()) {
                log.info("connection is already closed, key:{}, n:{}", connectInfo.getKey(), connectInfo.getRefCount());
                return;
            }
        } catch (SQLException e) {
            log.error("connection close error",e);
        }
        ConnectInfo lock = CONNECTION_MAP.get(key);
        if (lock != null) {
            synchronized (lock) {
                int n = lock.decrementRefCount();
                if (n == 0) {
                    lock.setLastAccessTime(new Date());
                    lock.setConnection(connectInfo.getConnection());
                } else {
                    connectInfo.close();
                }
            }
        } else {
            connectInfo.close();
        }


    }
}
