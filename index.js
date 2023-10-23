const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { config } = require('dotenv');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, push } = require('firebase/database');
const { getAuth, createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signInWithEmailAndPassword, getUserByEmail } = require('firebase/auth');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount/serviceAccountKey.json');

// Carrega as variáveis de ambiente do arquivo .env
config();

const app = express();
const PORT = 8000;
app.use(cors())

// Configurar o Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

// Middleware para analisar solicitações JSON
app.use(bodyParser.json());

// Rota de login
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    // Autenticar usuário no Firebase
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Buscar dados do usuário no Realtime Database usando o UID como identificador
    const userSubCollectionRef = ref(database, `usuarios/${user.uid}/dispositivos`);
    const userSubCollectionSnapshot = await get(userSubCollectionRef);

    let userData = [];

    if (userSubCollectionSnapshot.exists()) {
      userSubCollectionSnapshot.forEach((childSnapshot) => {
        userData.push({ device: childSnapshot.key, data: childSnapshot.val() });
      });
    }

    if (userData.length > 0) {
      res.json({ message: 'Login bem-sucedido', userData }); // user
    } else {
      res.status(404).json({ message: 'Dados do usuário não encontrados' });
    }
  } catch (error) {
    console.error('Erro ao autenticar usuário:', error);
    res.status(401).json({ message: 'Credenciais inválidas' });
  }
});

// Rota para registrar usuário e criar estrutura inicial no Realtime Database
app.post('/api/v1/auth/register', async (req, res) => {
  const { email, password, name, accessToken } = req.body;

  if (!email || !password || !name || !accessToken) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    let deviceId = accessToken
    // Tente criar um usuário e capture qualquer erro
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Atualizar o perfil do usuário com o nome fornecido
    await updateProfile(user, { displayName: name });

    // Adicionar informações adicionais ao nó do usuário no Realtime Database
    const userRef = ref(database, `usuarios/${user.uid}`);
    await set(userRef, {
      name,
      email,
      createdAt: new Date().toISOString()
    });

    // Cria o nó "dispositivo" com o ID de dispositivo fornecido
    const dispositivoRef = ref(database, `usuarios/${user.uid}/dispositivos/${deviceId}`);
    await set(dispositivoRef, {});

    // Cria o nó "dados" dentro do nó "dispositivo"
    const dadosRef = ref(database, `usuarios/${user.uid}/dispositivos/${deviceId}/dados`);
    await set(dadosRef, {});

    // Cria o nó "tempoReal" dentro do nó "dados"
    const tempoRealRef = ref(database, `usuarios/${user.uid}/dispositivos/${deviceId}/dados/tempoReal`);
    await set(tempoRealRef, {});

    // Adiciona as informações iniciais ao nó "tempoReal"
    await set(tempoRealRef, {
      MS: 0,
      UA: 0,
      TP: 0,
      RL: false,
      S1: 0,
      S2: 0,
      RG: false,
      TIME: Date.now(),
      HR: obterHorarioAtual(),
      DAY: obterDataAtual()
    });

    res.json({ message: 'Usuário registrado com sucesso', user });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);

    let errorMessage = 'Erro interno do servidor';

    // Tratar erros específicos
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'Este e-mail já está em uso. Por favor, use outro.';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'A senha fornecida é fraca. Escolha uma senha mais forte.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'O e-mail fornecido não é válido.';
    }

    // Se o código de erro não for tratado, envie uma resposta de erro genérica
    res.status(500).json({ message: errorMessage });
  }
});

// Rota para redefinir senha
app.post('/api/v1/auth/reset-password', async (req, res) => {
  const { email } = req.body;

  try {
    // Enviar e-mail de redefinição de senha
    await sendPasswordResetEmail(auth, email);

    res.json({ message: 'E-mail de redefinição de senha enviado com sucesso' });
  } catch (error) {
    console.error('Erro ao redefinir senha:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Rota para enviar dados ao Firestore do usuário
app.post('/api/v1/realtime/data-receive', async (req, res) => {
  const { getAuth } = require('firebase-admin/auth');

  const { userId, accessToken, MS, UA, TP, RL, S1, S2, RG } = req.body;

  if (!userId || !accessToken || !MS || !UA || !TP || !RL || !S1 || !S2 || !RG) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    // Verificar se o usuário existe no Firebase Authentication
    const auth = getAuth();
    const userRecord = await auth.getUserByEmail(userId);
    const uid = userRecord.uid;

    // Continuar apenas se o usuário existir
    if (uid) {
      const dadosRef = ref(database, `usuarios/${uid}/dispositivos/${accessToken}/dados/tempoReal`);

      const dataToUpdate = {
        MS,
        UA,
        TP,
        RL,
        S1,
        S2,
        RG,
        TIME: Date.now(),
        HR: obterHorarioAtual(),
        DAY: obterDataAtual()
      };

      // Adiciona ou atualiza os dados no nó específico
      await set(dadosRef, dataToUpdate);

      // Se RG é verdadeiro, cria a coleção "alertas" e adiciona subdocumentos "irrigacao"
      if (RG === 'true') {
        const alertasRef = ref(database, `usuarios/${uid}/dispositivos/${accessToken}/dados/alertas`);

        // Adiciona subdocumento com timestamp
        const newSubdocRef = push(alertasRef);
        await set(newSubdocRef, {
          timestamp: Date.now(),
          mensagem: 'Irrigação realizada'
        });

        console.log('Novo subdocumento de irrigação adicionado:', newSubdocRef.key);
      }

      res.sendStatus(200);
    } else {
      res.status(404).json({ message: 'Usuário não encontrado no Firebase Authentication' });
    }
  } catch (error) {
    console.error('Erro ao salvar dados do dispositivo:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Rota para pegaros dados dos alertas
app.post('/api/v1/realtime/alerts', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    // Autenticar usuário no Firebase
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Buscar dados do usuário no Realtime Database usando o UID como identificador
    const userSubCollectionRef = ref(database, `usuarios/${user.uid}/dispositivos`);
    const userSubCollectionSnapshot = await get(userSubCollectionRef);

    let userData = [];

    if (userSubCollectionSnapshot.exists()) {
      userSubCollectionSnapshot.forEach((childSnapshot) => {
        const { dados } = childSnapshot.val();
        const { alertas } = dados || {};

        if (alertas) {
          const alertasArray = Object.values(alertas).map((alerta) => {
            const { mensagem, timestamp } = alerta;
            const { day, time } = timestampToDateTime(timestamp);

            return { mensagem, timestamp: { day, time } };
          });

          userData.push({ device: childSnapshot.key, alertas: alertasArray });
        }
      });
    }

    if (userData.length > 0) {
      res.json({ message: 'Login bem-sucedido', userData });
    } else {
      res.status(404).json({ message: 'Dados do usuário não encontrados' });
    }
  } catch (error) {
    console.error('Erro ao autenticar usuário:', error);
    res.status(401).json({ message: 'Credenciais inválidas' });
  }
});

function obterHorarioAtual() {
  // Obtém a data e hora atual no fuso horário de São Paulo
  var agora = new Date(Date.now());
  var options = { timeZone: 'America/Sao_Paulo' };

  // Obtém horas, minutos e segundos
  var horas = agora.toLocaleString('pt-BR', options).split(' ')[1];

  return horas;
}

function obterDataAtual() {
  // Obtém a data e hora atual no fuso horário de São Paulo
  var agora = new Date(Date.now());
  var options = { timeZone: 'America/Sao_Paulo' };

  // Obtém o dia, mês e ano
  var dataFormatada = agora.toLocaleDateString('pt-BR', options);

  return dataFormatada;
}

const timestampToDateTime = (timestamp) => {
  const date = new Date(timestamp);
  const options = { timeZone: 'America/Sao_Paulo' };

  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', ...options });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...options });

  return { day, time };
};

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
