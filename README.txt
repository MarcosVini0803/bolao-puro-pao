BOLÃO PURO PÃO - VERSÃO FINAL MYSQL

Senha do admin:
Marcos080325

O que vem pronto:
- Site completo
- MySQL
- QR Code PIX embutido
- PIX Copia e Cola
- Upload de comprovante
- Painel administrativo
- Cadastro de jogos futuros
- Status Pago/Pendente/Cancelado
- Cálculo automático de prêmio 80% e organização 20%
- Exportar CSV

COMO RODAR:

1) Extraia o ZIP.

2) Abra o PowerShell na pasta do projeto.

3) Instale:
npm install

4) Rode:
npm start

5) Abra:
http://localhost:3000

OBSERVAÇÃO SOBRE MYSQL:
O sistema tenta criar automaticamente o banco bolao_puro_pao.

Se der erro de senha do MySQL:
- Abra o arquivo .env
- Edite DB_PASSWORD=
- Coloque a senha do seu MySQL root

Exemplo:
DB_PASSWORD=sua_senha_aqui

Se quiser criar manualmente, abra o MySQL Workbench e execute o arquivo:
setup_mysql.sql
