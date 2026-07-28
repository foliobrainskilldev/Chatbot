const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

// Função personalizada para guardar estado do Baileys no PostgreSQL via Prisma
const usePrismaAuthState = async (prisma) => {
    const writeData = async (data, id) => {
        const dataString = JSON.stringify(data, BufferJSON.replacer);
        await prisma.sessaoBaileys.upsert({
            where: { id },
            update: { data: dataString },
            create: { id, data: dataString }
        });
    };

    const readData = async (id) => {
        try {
            const session = await prisma.sessaoBaileys.findUnique({ where: { id } });
            if (session && session.data) {
                return JSON.parse(session.data, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            return null;
        }
    };

    const removeData = async (id) => {
        try {
            await prisma.sessaoBaileys.delete({ where: { id } });
        } catch (error) {}
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};

module.exports = usePrismaAuthState;