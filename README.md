# EUDORA — Gmail real com OAuth 2.0

Projeto Node.js + Express com interface web responsiva e integração real com a API oficial do Gmail. Implementa login Google OAuth 2.0, consulta de mensagens, busca usando operadores do Gmail, leitura do conteúdo e criação/listagem de rascunhos. **Não envia e-mails** nesta versão.

## Requisitos
- Node.js 20 ou superior
- Conta Google com Gmail
- Projeto no Google Cloud com Gmail API ativada

## 1. Configurar Google Cloud
1. Abra https://console.cloud.google.com/ e crie/seleciona um projeto.
2. Em APIs e serviços, ative **Gmail API**.
3. Configure a tela de consentimento OAuth (Google Auth Platform / Branding e Audience).
4. Em Clientes, crie um **ID do cliente OAuth 2.0** do tipo **Aplicativo da Web**.
5. Em **URIs de redirecionamento autorizados**, adicione exatamente `http://localhost:3000/auth/google/callback`.
6. Se necessário, adicione `http://localhost:3000` em origens JavaScript autorizadas.
7. Copie o Client ID e Client Secret. Em modo de teste, adicione sua conta Google como usuário de teste na tela Audience.

O Google pode exigir verificação do app se você disponibilizar para usuários externos ou pedir escopos restritos em produção. Consulte as políticas atuais do Google antes de publicar.

## 2. Instalar e configurar
No terminal, entre na pasta do projeto e execute:

```bash
npm install
```

Copie `.env.example` para `.env` e preencha:

```env
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
SESSION_SECRET=uma-chave-aleatoria-longa
PORT=3000
NODE_ENV=development
```

Gere uma chave de sessão com `openssl rand -hex 32` (ou use um gerador seguro). **Nunca publique o `.env` nem o Client Secret.**

## 3. Executar

```bash
npm start
```

Abra `http://localhost:3000`, clique em **Conectar Gmail**, escolha a conta e aceite as permissões solicitadas.

## Recursos e permissões
- `gmail.readonly`: listar e ler mensagens.
- `gmail.compose`: criar e consultar rascunhos.
- `userinfo.email`: mostrar a conta conectada.

O aplicativo solicita apenas leitura e composição; não tem código de envio ou exclusão. A busca usa a sintaxe do Gmail, por exemplo `from:alguem@example.com`, `is:unread`, `subject:nota fiscal`, `newer_than:7d`.

## Segurança / produção
- Este exemplo usa sessão Express em memória: apropriado para teste local, não para implantação com múltiplas instâncias. Em produção, use um armazenamento de sessão persistente e seguro.
- Configure HTTPS e `NODE_ENV=production` ao publicar; cookies seguros exigem HTTPS.
- Restrinja origens e URIs OAuth ao seu domínio real, não use o Client Secret no navegador, e não registre tokens.
- O consentimento OAuth e a verificação do Google dependem do tipo de conta, público e escopos utilizados.
- Revise a política de privacidade e as regras de uso de dados do Google antes de disponibilizar a terceiros.

## Observação sobre IA
O chat desta entrega roteia alguns comandos simples para a API Gmail; ele não é um modelo de IA generativa. Para resumos semânticos ou conversa geral, integre um provedor de IA no servidor e informe ao usuário como os e-mails serão processados.
