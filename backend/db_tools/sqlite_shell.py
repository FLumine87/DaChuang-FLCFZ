import sqlite3

conn = sqlite3.connect('mental_screening.db')
cursor = conn.cursor()
print('SQLite shell. Type .exit to quit')

while True:
    try:
        cmd = input('sqlite> ')
        if cmd.strip() == '.exit':
            break
        cursor.execute(cmd)
        print(cursor.fetchall())
    except Exception as e:
        print(e)

conn.close()