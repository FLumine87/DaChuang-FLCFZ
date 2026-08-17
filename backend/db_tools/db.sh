#!/bin/bash

COMPOSE_FILE="db_tools/docker-compose.db.yml"
CONTAINER_NAME="mental-screening-db-tools"

show_help() {
    echo ""
    echo "数据库管理工具"
    echo ""
    echo "用法: ./db.sh [命令]"
    echo ""
    echo "命令:"
    echo "  start     启动数据库管理容器"
    echo "  stop      停止容器"
    echo "  init      初始化数据库（创建表和示例数据）"
    echo "  reset     重置数据库（清空后重新初始化）"
    echo "  shell     进入 Python 交互环境"
    echo "  sql       进入 SQLite 命令行"
    echo "  backup    备份数据库到 data 目录"
    echo "  restore   从备份恢复数据库"
    echo "  status    查看数据库状态"
    echo "  build     构建镜像"
    echo ""
}

build() {
    echo "构建数据库管理镜像..."
    docker compose -f $COMPOSE_FILE build
}

start() {
    echo "启动数据库管理容器..."
    docker compose -f $COMPOSE_FILE up -d
    echo "容器已启动，使用 './db.sh shell' 进入交互环境"
}

stop() {
    echo "停止容器..."
    docker compose -f $COMPOSE_FILE down
}

init() {
    echo "初始化数据库..."
    docker compose -f $COMPOSE_FILE up -d --build 2>/dev/null
    docker exec -it $CONTAINER_NAME python init_data.py
    echo ""
    echo "初始化完成！"
    echo "数据库文件: mental_screening.db"
}

reset() {
    echo "重置数据库..."
    rm -f mental_screening.db
    docker compose -f $COMPOSE_FILE up -d --build 2>/dev/null
    docker exec -it $CONTAINER_NAME python init_data.py
    echo ""
    echo "数据库已重置！"
}

shell() {
    docker compose -f $COMPOSE_FILE up -d 2>/dev/null
    docker exec -it $CONTAINER_NAME python
}

sql() {
    docker compose -f $COMPOSE_FILE up -d 2>/dev/null
    docker exec -it $CONTAINER_NAME sqlite3 mental_screening.db
}

backup() {
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    mkdir -p data
    cp mental_screening.db data/backup_$TIMESTAMP.db
    echo "备份已保存到: data/backup_$TIMESTAMP.db"
}

restore() {
    echo "可用的备份文件:"
    echo ""
    ls -la data/backup_*.db 2>/dev/null || echo "没有找到备份文件"
    echo ""
    read -p "请输入备份文件名: " BACKUP_FILE
    if [ -f "data/$BACKUP_FILE" ]; then
        cp "data/$BACKUP_FILE" mental_screening.db
        echo "数据库已从 $BACKUP_FILE 恢复"
    else
        echo "文件不存在: $BACKUP_FILE"
    fi
}

status() {
    docker compose -f $COMPOSE_FILE up -d 2>/dev/null
    echo ""
    echo "=== 数据库状态 ==="
    echo ""
    docker exec $CONTAINER_NAME sqlite3 mental_screening.db \
        "SELECT '用户数: ' || COUNT(*) FROM users;
         SELECT '问卷数: ' || COUNT(*) FROM questionnaires;
         SELECT '筛查记录: ' || COUNT(*) FROM screenings;
         SELECT '预警记录: ' || COUNT(*) FROM alerts;
         SELECT '案例数: ' || COUNT(*) FROM cases;"
    echo ""
}

case "$1" in
    help|"") show_help ;;
    start) start ;;
    stop) stop ;;
    init) init ;;
    reset) reset ;;
    shell) shell ;;
    sql) sql ;;
    backup) backup ;;
    restore) restore ;;
    status) status ;;
    build) build ;;
    *) echo "Unknown command: $1"; show_help ;;
esac
