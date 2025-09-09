<img width="200" height="200" alt="image" src="https://github.com/user-attachments/assets/fc3b1bba-eadf-4e71-8c23-6b5f1a0c55a1" />

<br/>

# Metasys Alarm Viewer

## Sobre a aplicação
O MAV (Metasys Alarm Viewer) é uma aplicação voltada para ambientes on-premise, desenvolvida com o objetivo de centralizar a visualização de alarmes provenientes de múltiplos servidores ADX e ADS, desde que estejam na versão 10 ou superior e com a API habilitada.
Através do MAV, é possível:

- Visualizar alarmes em tempo real;
- Inserir comentários diretamente nos eventos;
- Facilitar o monitoramento e a tomada de decisão em operações críticas.

Atualmente, está em desenvolvimento uma nova funcionalidade que permitirá o reconhecimento automático de alarmes e o descarte inteligente de eventos irrelevantes, otimizando ainda mais a gestão e a resposta a ocorrências.

## Tecnologias
- Typescript, por conta da tipagem
- Framework REACT, pela vasta documentação e por ser uma aplicação que executa sem necessidade de backend
- Arquitetura limpa, com uso de camadas e DTO
- Design Atômico, necessário para otimizar a reusabildiade do código.

## Documentação da API
Toda documentação de como ocorre a interação da API, pode ser acessada pelo link: https://jci-metasys.github.io/api-landing/

## Como funciona?
Primeiramente o MAV realiza login com o usuário metasys, importante frisar que esse usuario deve ser do tipo API, porque é fornecido a funcionalidade de acesso e coleta. Sequencialmente, a aplicação recebe um token que é utilizado para handshake de qualquer solicitação de alarme. Os alarmes são requisitados e enviados via JSON, e depois organizados em uma tabela.
