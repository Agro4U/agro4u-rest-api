const express = require('express');
const bodyParser = require('body-parser');
const { config } = require('dotenv');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, collection, getDocs, addDoc, getDoc } = require('firebase/firestore');
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } = require('firebase/auth');

// Carrega as variáveis de ambiente do arquivo .env
config();

const app = express();
const PORT = 8000;

// Configurar o Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const firestore = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// Middleware para analisar solicitações JSON
app.use(bodyParser.json());

// Rota de login
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Autenticar usuário no Firebase
    await signInWithEmailAndPassword(auth, email, password);

    // Obtém informações do usuário autenticado
    const user = auth.currentUser;

    res.json({ message: 'Login bem-sucedido', user });
  } catch (error) {
    console.error('Erro ao autenticar usuário:', error);
    res.status(401).json({ message: 'Credenciais inválidas' });
  }
});

// Rota de registro
app.post('/api/v1/auth/register', async (req, res) => {
  const { email, password, name } = req.body;

  try {
    // Verificar se o usuário já existe
    console.log('Objeto auth antes de getUserByEmail:', auth);
    const userRecord = await auth.getUserByEmail(email);
    console.log('Objeto auth após getUserByEmail:', auth);

    // Se o usuário existir, envie uma mensagem de erro
    if (userRecord) {
      res.status(400).json({ message: 'Este e-mail já está em uso. Por favor, use outro.' });
      return;
    }

    // Se o usuário não existir, continue com o registro
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Atualizar o perfil do usuário com o nome fornecido
    await updateProfile(user, { displayName: name });

    // Adicionar informações adicionais ao documento do usuário no Firestore
    const userDocRef = doc(firestore, 'usuarios', user.uid);
    await setDoc(userDocRef, {
      name,
      email,
      createdAt: new Date()
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
  const { userId, accessToken, MS, UA, TP, RL, S1, S2, RG } = req.body;

  if (!userId || !accessToken || !MS || !UA || !TP || !RL || !S1 || !S2 || RG === undefined) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }

  try {
    const dadosDocRef = doc(firestore, 'usuarios', userId, 'dispositivos', accessToken, 'dados', 'tempoReal');

    const dataToUpdate = {
      MS,
      UA,
      TP,
      RL,
      S1,
      S2
    };

    // Verifica se o documento "dados" já existe
    const dadosDoc = await getDoc(dadosDocRef);

    // Se o documento "dados" não existir, cria o documento
    if (!dadosDoc.exists()) {
      await setDoc(dadosDocRef, {});
    }

    // Adiciona ou atualiza os dados no documento "dados"
    await setDoc(dadosDocRef, dataToUpdate, { merge: true });

    // Se RG é verdadeiro, cria a coleção "alertas" e adiciona subdocumentos "irrigacao"
    if (RG === 'true') {
      const alertasCollectionRef = collection(firestore, 'usuarios', userId, 'dispositivos', accessToken, 'dados');
      const irrigacaoDocRef = doc(alertasCollectionRef, 'alertas');

      // Adiciona subdocumento com timestamp
      const newSubdocRef = await addDoc(collection(irrigacaoDocRef, 'irrigacao'), {
        timestamp: Date.now(),
        mensagem: 'Irrigação realizada'
      });

      console.log('Novo subdocumento de irrigação adicionado:', newSubdocRef.id);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro ao salvar dados do dispositivo:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }

});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
